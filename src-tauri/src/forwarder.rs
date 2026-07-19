// forwarder.rs - Forwards TUN packets via SOCKS5 proxy
// Spawns Tokio RT, handles TCP flows + UDP packets
use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::packet::{Packet, Ipv4Header, TcpHeader, UdpHeader, ConnKey, TCP_SYN, TCP_ACK, TCP_FIN, TCP_RST};
use crate::socks5::Socks5Stream;

#[cfg(target_os = "windows")]
use wintun::Session;

pub struct Forwarder {
    socks5_addr: String,
    socks5_port: u16,
}

impl Forwarder {
    pub fn new(addr: String, port: u16) -> Self {
        Forwarder { socks5_addr: addr, socks5_port: port }
    }
}

/// Run forwarder: read packets from TUN, forward via SOCKS5, write back
#[cfg(target_os = "windows")]
pub fn run(
    session: Arc<Session>,
    running: Arc<AtomicBool>,
    socks5_addr: String,
    socks5_port: u16,
) -> Result<()> {
    // Build tokio runtime
    let rt = tokio::runtime::Runtime::new()
        .context("Failed to create tokio runtime")?;

    rt.block_on(async move {
        // Connection table: tracks TCP flows
        let mut tcp_conns: HashMap<ConnKey, Arc<tokio::sync::Mutex<Option<Socks5Stream>>>> = HashMap::new();
        let _forwarder = Forwarder::new(socks5_addr.clone(), socks5_port);

        while running.load(Ordering::Relaxed) {
            // Read packet (blocking call to wintun)
            let pkt_buf = match session.receive_blocking() {
                Ok(p) => p,
                Err(e) => {
                    if running.load(Ordering::Relaxed) {
                        eprintln!("TUN recv error: {:?}", e);
                    }
                    break;
                }
            };

            let raw = pkt_buf.bytes();
            if raw.is_empty() { continue; }

            match Packet::parse(raw) {
                Some(Packet::Ipv4(ip)) => {
                    let payload = ip.payload(raw);
                    if ip.is_tcp() {
                        if let Some(tcp) = TcpHeader::parse(payload) {
                            let conn = ConnKey {
                                src_ip: ip.src.to_string(),
                                dst_ip: ip.dst.to_string(),
                                src_port: tcp.src_port,
                                dst_port: tcp.dst_port,
                                protocol: 6,
                            };

                            // SYN: open new connection to SOCKS5
                            if tcp.is_syn() {
                                let dst_ip = ip.dst.to_string();
                                let dst_port = tcp.dst_port;
                                let socks_addr = socks5_addr.clone();
                                let socks_port = socks5_port;

                                tokio::spawn(async move {
                                    match Socks5Stream::connect(&socks_addr, socks_port, &dst_ip, dst_port) {
                                        Ok(stream) => {
                                            // TODO: wrap and store + start reader/writer
                                            eprintln!("SOCKS5 TCP conn established to {}:{}", dst_ip, dst_port);
                                            // stream dropped here — placeholder
                                        }
                                        Err(e) => {
                                            eprintln!("SOCKS5 connect failed to {}:{}: {}", dst_ip, dst_port, e);
                                        }
                                    }
                                });
                                let _ = conn; // appease borrow checker for now
                            }
                            // TODO: forward data packets, handle FIN/RST
                        }
                    } else if ip.is_udp() {
                        if let Some(udp) = UdpHeader::parse(payload) {
                            // UDP via SOCKS5: associate or per-packet connect
                            // For simplicity: per-packet connect+write+close (high overhead)
                            let _ = udp;
                        }
                    } else {
                        // Non-TCP/UDP (ICMP etc): drop
                    }
                }
                Some(Packet::Ipv6(_)) => {
                    // IPv6: drop for now (full VPN usually forces v4 in TUN)
                }
                None => { eprintln!("Dropping non-IP packet"); }
            }
        }

        Ok(())
    })
}
