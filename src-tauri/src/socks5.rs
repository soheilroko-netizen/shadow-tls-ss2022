// socks5.rs - Minimal SOCKS5 client for forwarding TUN traffic
use anyhow::{bail, Context, Result};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// SOCKS5 connection wrapper
pub struct Socks5Stream {
    inner: TcpStream,
}

impl Socks5Stream {
    /// Connect to destination via SOCKS5 proxy
    pub fn connect(
        proxy_addr: &str,
        proxy_port: u16,
        dst_ip: &str,
        dst_port: u16,
    ) -> Result<Self> {
        let stream = TcpStream::connect((proxy_addr, proxy_port))
            .context("Failed to connect to SOCKS5 proxy")?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        stream.set_write_timeout(Some(Duration::from_secs(10)))?;

        let mut s = Socks5Stream { inner: stream };
        s.handshake(dst_ip, dst_port)?;
        Ok(s)
    }

    /// SOCKS5 handshake: auth + connect request
    fn handshake(&mut self, dst_ip: &str, dst_port: u16) -> Result<()> {
        // Greeting: no auth
        self.inner.write_all(&[0x05, 0x01, 0x00])?;
        let mut resp = [0u8; 2];
        self.inner.read_exact(&mut resp)?;
        if resp[0] != 0x05 || resp[1] != 0x00 {
            bail!("SOCKS5 auth negotiation failed");
        }

        // Connect request: IPv4 or domain
        let dst_addr: std::net::IpAddr = dst_ip.parse()
            .map_err(|_| anyhow::anyhow!("invalid IP"))?;
        
        let mut req = vec![0x05, 0x01, 0x00, 0x01]; // VER, CMD=CONNECT, RSV, ATYP
        match dst_addr {
            std::net::IpAddr::V4(v4) => {
                req[3] = 0x01; // ATYP=IPv4
                req.extend_from_slice(&v4.octets());
            }
            std::net::IpAddr::V6(v6) => {
                req[3] = 0x04; // ATYP=IPv6
                req.extend_from_slice(&v6.octets());
            }
        }
        req.extend_from_slice(&dst_port.to_be_bytes());
        self.inner.write_all(&req)?;

        // Read response (at least 10 bytes for IPv4)
        let mut buf = [0u8; 256];
        let n = self.inner.read(&mut buf)?;
        if n < 10 {
            bail!("SOCKS5 response too short");
        }
        if buf[1] != 0x00 {
            bail!("SOCKS5 connect failed: rep={}", buf[1]);
        }
        Ok(())
    }

    pub fn get_ref(&self) -> &TcpStream {
        &self.inner
    }

    pub fn get_mut(&mut self) -> &mut TcpStream {
        &mut self.inner
    }
}

impl Read for Socks5Stream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Write for Socks5Stream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
