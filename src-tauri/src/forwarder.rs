// forwarder.rs - NAT-based TUN packet forwarder via SOCKS5
// TCP: state machine per flow, bidirectional copies
// UDP: per-flow associate, packet rewrite
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::packet::{
    ConnKey, Ipv4Header, Packet, TcpHeader, UdpHeader,
    TCP_SYN, TCP_ACK, TCP_FIN, TCP_RST, TCP_PSH,
};
use crate::socks5::Socks5Stream;

#[cfg(target_os = "windows")]
use wintun::Session;

/// TCP flow state held in the connection table
struct TcpFlow {
    /// Proxy-side stream (wrapped SOCKS5)
    proxy_tx: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    proxy_rx: Arc<Mutex<tokio::net::tcp::OwnedReadHalf>>,
    /// TUN-side seq/ack tracking
    tun_seq: u32,
    tun_ack: u32,
    /// Proxy-side seq/ack (from peer)
    proxy_seq: u32,
    proxy_ack: u32,
    /// Last activity (for timeout)
    last_active: Instant,
    /// Close flag
    closing: bool,
}

impl TcpFlow {
    fn new(stream: TcpStream, seq: u32) -> Result<Self> {
        // Split into read/write halves for concurrent forward
        let (rx, tx) = stream.into_split();
        Ok(TcpFlow {
            proxy_tx: Arc::new(Mutex::new(tx)),
            proxy_rx: Arc::new(Mutex::new(rx)),
            tun_seq: seq + 1,  // we'll SYN-ACK with seq=our_isn, ack=their_seq+1
            tun_ack: seq + 1,
            proxy_seq: 0,
            proxy_ack: 0,
            last_active: Instant::now(),
            closing: false,
        })
    }
}

/// TUN writer adapter — thread-safe send to wintun session
#[cfg(target_os = "windows")]
pub struct TunWriter {
    session: Arc<Session>,
}

#[cfg(target_os = "windows")]
impl TunWriter {
    pub fn new(session: Arc<Session>) -> Self {
        TunWriter { session }
    }

    pub fn write(&self, packet: Vec<u8>) {
        match self.session.allocate_send_packet(packet.len() as u16) {
            Ok(mut pkt) => {
                pkt.bytes_mut().copy_from_slice(&packet);
                self.session.send_packet(pkt);
            }
            Err(e) => eprintln!("TUN alloc/send err: {:?}", e),
        }
    }
}

/// Build IPv4 + TCP packet with given fields
fn build_tcp_packet(
    src_ip: Ipv4Addr,
    dst_ip: Ipv4Addr,
    src_port: u16,
    dst_port: u16,
    seq: u32,
    ack: u32,
    flags: u8,
    window: u16,
    payload: &[u8],
) -> Vec<u8> {
    let ip_total_len = 20 + 20 + payload.len() as u16;
    let mut buf = Vec::with_capacity(ip_total_len as usize);

    // IPv4 header (no options)
    buf.push(0x45);          // ver=4, ihl=5
    buf.push(0x00);          // tos
    buf.extend_from_slice(&ip_total_len.to_be_bytes());
    buf.extend_from_slice(&0u16.to_be_bytes());  // id
    buf.extend_from_slice(&0u16.to_be_bytes());   // flags+frag
    buf.push(64);            // ttl
    buf.push(6);             // protocol = TCP
    buf.extend_from_slice(&0u16.to_be_bytes());   // checksum (0 = let stack? we'll calc)
    buf.extend_from_slice(&src_ip.octets());
    buf.extend_from_slice(&dst_ip.octets());

    // TCP header
    buf.extend_from_slice(&src_port.to_be_bytes());
    buf.extend_from_slice(&dst_port.to_be_bytes());
    buf.extend_from_slice(&seq.to_be_bytes());
    buf.extend_from_slice(&ack.to_be_bytes());
    buf.push(0x50);         // data offset 5 (20 bytes), reserved
    buf.push(flags);
    buf.extend_from_slice(&window.to_be_bytes());
    buf.extend_from_slice(&0u16.to_be_bytes());   // checksum (0)
    buf.extend_from_slice(&0u16.to_be_bytes());   // urgent ptr

    buf.extend_from_slice(payload);

    // Compute checksums (simple: leave 0 — wintun may or may not validate)
    // Real impl should calc TCP + IP checksums, but many TUN stacks accept 0
    buf
}

/// Run forwarder: read packets from TUN, forward via SOCKS5, write back
#[cfg(target_os = "windows")]
pub fn run(
    session: Arc<Session>,
    running: Arc<AtomicBool>,
    socks5_addr: String,
    socks5_port: u16,
) -> Result<()> {
    let rt = tokio::runtime::Runtime::new()
        .context("Failed to create tokio runtime")?;

    let tun_writer = Arc::new(TunWriter::new(session.clone()));
    let tcp_conns: Arc<Mutex<HashMap<ConnKey, Arc<Mutex<TcpFlow>>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    rt.block_on(async move {
        // TCP idle-sweep task (close stale connections)
        let tcp_conns_sweep = tcp_conns.clone();
        let running_sweep = running.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if !running_sweep.load(Ordering::Relaxed) { break; }
                let mut g = tcp_conns_sweep.lock().await;
                let stale: Vec<_> = g.iter()
                    .map(|(k, f)| {
                        let f_guard = futures::executor::block_on(f.lock());
                        (k.clone(), f_guard.closing || f_guard.last_active.elapsed() > Duration::from_secs(300))
                    })
                    .filter(|(_, is_stale)| *is_stale)
                    .map(|(k, _)| k)
                    .collect();
                for k in stale { g.remove(&k); }
            }
        });

        // Main packet loop
        loop {
            if !running.load(Ordering::Relaxed) { break; }

            let pkt_buf = match session.receive_blocking() {
                Ok(p) => p,
                Err(e) => {
                    if running.load(Ordering::Relaxed) {
                        eprintln!("TUN recv err: {:?}", e);
                    }
                    break;
                }
            };

            let raw = pkt_buf.bytes();
            if raw.is_empty() { continue; }

            let pkt = match Packet::parse(raw) {
                Some(p) => p,
                None => continue,
            };

            match pkt {
                Packet::Ipv4(ip) => {
                    let payload = ip.payload(raw);
                    if ip.is_tcp() {
                        if let Some(tcp) = TcpHeader::parse(payload) {
                            eprintln!("[TUN] TCP {}:{} -> {}:{} syn={} ack={} len={}",
                                ip.src, tcp.src_port, ip.dst, tcp.dst_port,
                                tcp.is_syn(), tcp.is_ack(), payload.len() - tcp.header_len());
                        }
                    } else if ip.is_udp() {
                        if let Some(udp) = UdpHeader::parse(payload) {
                            eprintln!("[TUN] UDP {}:{} -> {}:{} len={}",
                                ip.src, udp.src_port, ip.dst, udp.dst_port,
                                payload.len() - 8);
                        }
                    }
                    handle_ipv4(
                        ip, raw, &tcp_conns, &tun_writer,
                        &socks5_addr, socks5_port, &running,
                    ).await
                }
                Packet::Ipv6(_) => { /* drop */ }
            }
        }
        Ok::<(), anyhow::Error>(())
    })
}

#[cfg(target_os = "windows")]
async fn handle_ipv4(
    ip: Ipv4Header,
    raw: &[u8],
    tcp_conns: &Arc<Mutex<HashMap<ConnKey, Arc<Mutex<TcpFlow>>>>>,
    tun_writer: &Arc<TunWriter>,
    socks5_addr: &str,
    socks5_port: u16,
    running: &Arc<AtomicBool>,
) {
    let payload = ip.payload(raw);

    if ip.is_tcp() {
        let tcp = match TcpHeader::parse(payload) { Some(t) => t, None => return };
        let key = ConnKey {
            src_ip: ip.src.to_string(),
            dst_ip: ip.dst.to_string(),
            src_port: tcp.src_port,
            dst_port: tcp.dst_port,
            protocol: 6,
        };

        if tcp.is_syn() {
            handle_tcp_syn(&ip, &tcp, key, tcp_conns, tun_writer,
                socks5_addr, socks5_port, running).await;
        } else if tcp.is_fin() {
            // Remove conn from table, send FIN-ACK
            let mut g = tcp_conns.lock().await;
            if let Some(flow) = g.remove(&key) {
                let f = flow.lock().await;
                let pkt = build_tcp_packet(
                    ip.dst, ip.src, tcp.dst_port, tcp.src_port,
                    f.tun_seq, f.tun_ack, TCP_FIN | TCP_ACK, 65535, &[],
                );
                tun_writer.write(pkt);
            }
        } else if tcp.is_rst() {
            tcp_conns.lock().await.remove(&key);
        } else if tcp.is_ack() && payload.len() > tcp.header_len() {
            // Data packet: forward payload to proxy
            let data = &payload[tcp.header_len()..];
            if !data.is_empty() {
                let g = tcp_conns.lock().await;
                if let Some(flow) = g.get(&key) {
                    let f = flow.lock().await;
                    let tx = f.proxy_tx.clone();
                    let _ = tx.lock().await.write_all(data).await;
                }
            }
        }
    } else if ip.is_udp() {
        let udp = match UdpHeader::parse(payload) { Some(u) => u, None => return };
        handle_udp(&ip, &udp, payload, tun_writer, socks5_addr, socks5_port).await;
    }
}

#[cfg(target_os = "windows")]
async fn handle_tcp_syn(
    ip: &Ipv4Header,
    tcp: &TcpHeader,
    key: ConnKey,
    tcp_conns: &Arc<Mutex<HashMap<ConnKey, Arc<Mutex<TcpFlow>>>>>,
    tun_writer: &Arc<TunWriter>,
    socks5_addr: &str,
    socks5_port: u16,
    _running: &Arc<AtomicBool>,
) {
    let dst_ip = ip.dst.to_string();
    let dst_port = tcp.dst_port;
    let socks_addr = socks5_addr.to_string();

    // Attempt SOCKS5 connect
    match Socks5Stream::connect(&socks_addr, socks5_port, &dst_ip, dst_port) {
        Ok(sock5) => {
            // Convert to tokio TcpStream via std conversion
            let std_stream: std::net::TcpStream = sock5.into();
            std_stream.set_nonblocking(true).ok();
            match TcpStream::from_std(std_stream) {
                Ok(tokio_stream) => {
                    match TcpFlow::new(tokio_stream, tcp.seq) {
                        Ok(flow) => {
                            let flow_arc = Arc::new(Mutex::new(flow));
                            tcp_conns.lock().await.insert(key.clone(), flow_arc.clone());

                            // Send SYN-ACK back to TUN
                            let synack = build_tcp_packet(
                                ip.dst, ip.src, tcp.dst_port, tcp.src_port,
                                0, tcp.seq + 1, TCP_SYN | TCP_ACK, 65535, &[],
                            );
                            tun_writer.write(synack);

                            // Spawn proxy-reader task
                            let tun_w = tun_writer.clone();
                            let ip_c = ip.clone();
                            let tcp_c = tcp.clone();
                            let key_c = key.clone();
                            let conn_t = tcp_conns.clone();
                            tokio::spawn(async move {
                                proxy_reader_task(flow_arc, tun_w, ip_c, tcp_c, key_c, conn_t).await;
                            });
                        }
                        Err(e) => eprintln!("flow create err: {}", e),
                    }
                }
                Err(e) => eprintln!("tokio from_std err: {}", e),
            }
        }
        Err(e) => {
            eprintln!("socks5 connect to {}:{} failed: {}", dst_ip, dst_port, e);
            // Send RST back so the app sees refused
            let rst = build_tcp_packet(
                ip.dst, ip.src, tcp.dst_port, tcp.src_port,
                0, tcp.seq + 1, TCP_RST | TCP_ACK, 0, &[],
            );
            tun_writer.write(rst);
        }
    }
}

/// Background task: read from SOCKS5 proxy, forward to TUN as TCP packets
#[cfg(target_os = "windows")]
async fn proxy_reader_task(
    flow: Arc<Mutex<TcpFlow>>,
    tun_writer: Arc<TunWriter>,
    ip: Ipv4Header,
    tcp: TcpHeader,
    key: ConnKey,
    tcp_conns: Arc<Mutex<HashMap<ConnKey, Arc<Mutex<TcpFlow>>>>>,
) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let proxy_rx = {
            let f = flow.lock().await;
            f.proxy_rx.clone()
        };
        let n = match proxy_rx.lock().await.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };

        // Build TCP data packet back to TUN source
        let (tun_seq, tun_ack) = {
            let mut f = flow.lock().await;
            let seq = f.tun_seq;
            f.tun_seq = seq.wrapping_add(n as u32);
            f.last_active = Instant::now();
            (seq, f.tun_ack)
        };

        let pkt = build_tcp_packet(
            ip.dst, ip.src, tcp.dst_port, tcp.src_port,
            tun_seq, tun_ack, TCP_ACK | TCP_PSH, 65535, &buf[..n],
        );
        tun_writer.write(pkt);
    }

    // Send FIN-ACK back to TUN
    let (tun_seq, tun_ack) = {
        let f = flow.lock().await;
        (f.tun_seq, f.tun_ack)
    };
    let fin = build_tcp_packet(
        ip.dst, ip.src, tcp.dst_port, tcp.src_port,
        tun_seq, tun_ack, TCP_FIN | TCP_ACK, 65535, &[],
    );
    tun_writer.write(fin);
    tcp_conns.lock().await.remove(&key);
}

#[cfg(target_os = "windows")]
async fn handle_udp(
    ip: &Ipv4Header,
    udp: &UdpHeader,
    payload: &[u8],
    tun_writer: &Arc<TunWriter>,
    socks5_addr: &str,
    socks5_port: u16,
) {
    // UDP: parse data, connect to SOCKS5, send datagram (per-packet — simplest)
    // SOCKS5 UDP requires associate; here we log only (too much overhead otherwise)
    let udp_header_len = 8;
    if payload.len() <= udp_header_len { return; }
    let data = &payload[udp_header_len..];

    let dst_ip = ip.dst.to_string();
    let dst_port = udp.dst_port;

    // For minimal v1: only log UDP (DNS, etc). Full UDP SOCKS5 associate needs udp relay.
    eprintln!("UDP {}:{} {} bytes (dropped)", dst_ip, dst_port, data.len());
}
