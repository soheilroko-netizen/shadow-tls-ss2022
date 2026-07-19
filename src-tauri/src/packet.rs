// packet.rs - IP/TCP/UDP packet parsing
// Minimal parser for TUN packet forwarding

use std::net::{Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone)]
pub enum Packet {
    Ipv4(Ipv4Header),
    Ipv6(Ipv6Header),
}

impl Packet {
    /// Parse raw bytes from TUN into a packet structure
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.is_empty() {
            return None;
        }
        let version = data[0] >> 4;
        match version {
            4 => Ipv4Header::parse(data).map(Packet::Ipv4),
            6 => Ipv6Header::parse(data).map(Packet::Ipv6),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Ipv4Header {
    pub version: u8,
    pub ihl: u8,
    pub total_length: u16,
    pub id: u16,
    pub flags: u8,
    pub fragment_offset: u16,
    pub ttl: u8,
    pub protocol: u8,
    pub checksum: u16,
    pub src: Ipv4Addr,
    pub dst: Ipv4Addr,
    pub payload_offset: usize,
}

#[derive(Debug, Clone)]
pub struct Ipv6Header {
    pub traffic_class: u8,
    pub flow_label: u32,
    pub payload_length: u16,
    pub next_header: u8,
    pub hop_limit: u8,
    pub src: Ipv6Addr,
    pub dst: Ipv6Addr,
    pub payload_offset: usize,
}

impl Ipv4Header {
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 20 {
            return None;
        }
        let version = data[0] >> 4;
        if version != 4 {
            return None;
        }
        let ihl = data[0] & 0x0F;
        let header_len = (ihl as usize) * 4;
        if data.len() < header_len {
            return None;
        }
        let total_length = u16::from_be_bytes([data[2], data[3]]);
        let id = u16::from_be_bytes([data[4], data[5]]);
        let flags = data[6] >> 5;
        let fragment_offset = u16::from_be_bytes([data[6] & 0x1F, data[7]]);
        let ttl = data[8];
        let protocol = data[9];
        let checksum = u16::from_be_bytes([data[10], data[11]]);
        let src = Ipv4Addr::new(data[12], data[13], data[14], data[15]);
        let dst = Ipv4Addr::new(data[16], data[17], data[18], data[19]);
        Some(Ipv4Header {
            version,
            ihl,
            total_length,
            id,
            flags,
            fragment_offset,
            ttl,
            protocol,
            checksum,
            src,
            dst,
            payload_offset: header_len,
        })
    }

    pub fn is_tcp(&self) -> bool {
        self.protocol == 6
    }

    pub fn is_udp(&self) -> bool {
        self.protocol == 17
    }

    pub fn payload<'a>(&self, data: &'a [u8]) -> &'a [u8] {
        if self.payload_offset >= data.len() {
            return &[];
        }
        let end = (self.total_length as usize).min(data.len());
        &data[self.payload_offset..end]
    }
}

impl Ipv6Header {
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 40 {
            return None;
        }
        let version = data[0] >> 4;
        if version != 6 {
            return None;
        }
        let traffic_class = ((data[0] & 0x0F) << 4) | (data[1] >> 4);
        let flow_label = u32::from_be_bytes([0, data[1] & 0x0F, data[2], data[3]]);
        let payload_length = u16::from_be_bytes([data[4], data[5]]);
        let next_header = data[6];
        let hop_limit = data[7];
        let src = Ipv6Addr::from([data[8], data[9], data[10], data[11],
                                 data[12], data[13], data[14], data[15],
                                 data[16], data[17], data[18], data[19],
                                 data[20], data[21], data[22], data[23]]);
        let dst = Ipv6Addr::from([data[24], data[25], data[26], data[27],
                                 data[28], data[29], data[30], data[31],
                                 data[32], data[33], data[34], data[35],
                                 data[36], data[37], data[38], data[39]]);
        Some(Ipv6Header {
            traffic_class,
            flow_label,
            payload_length,
            next_header,
            hop_limit,
            src,
            dst,
            payload_offset: 40,
        })
    }

    pub fn is_tcp(&self) -> bool {
        self.next_header == 6
    }

    pub fn is_udp(&self) -> bool {
        self.next_header == 17
    }

    pub fn payload<'a>(&self, data: &'a [u8]) -> &'a [u8] {
        if self.payload_offset >= data.len() {
            return &[];
        }
        let end = (self.payload_length as usize + self.payload_offset).min(data.len());
        &data[self.payload_offset..end]
    }
}

// TCP/UDP header parser
#[derive(Debug, Clone)]
pub struct TcpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub seq: u32,
    pub ack: u32,
    pub data_offset: u8,
    pub flags: u8,
    pub window: u16,
    pub checksum: u16,
    pub urgent_ptr: u16,
}

#[derive(Debug, Clone)]
pub struct UdpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub length: u16,
    pub checksum: u16,
}

pub const TCP_FIN: u8 = 0x01;
pub const TCP_SYN: u8 = 0x02;
pub const TCP_RST: u8 = 0x04;
pub const TCP_PSH: u8 = 0x08;
pub const TCP_ACK: u8 = 0x10;

impl TcpHeader {
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 20 {
            return None;
        }
        let src_port = u16::from_be_bytes([data[0], data[1]]);
        let dst_port = u16::from_be_bytes([data[2], data[3]]);
        let seq = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let ack = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let data_offset = data[12] >> 4;
        let flags = data[13] & 0x3F;
        let window = u16::from_be_bytes([data[14], data[15]]);
        let checksum = u16::from_be_bytes([data[16], data[17]]);
        let urgent_ptr = u16::from_be_bytes([data[18], data[19]]);
        Some(TcpHeader {
            src_port, dst_port, seq, ack,
            data_offset, flags, window, checksum, urgent_ptr,
        })
    }

    pub fn header_len(&self) -> usize {
        (self.data_offset as usize) * 4
    }

    pub fn is_syn(&self) -> bool { self.flags & TCP_SYN != 0 }
    pub fn is_ack(&self) -> bool { self.flags & TCP_ACK != 0 }
    pub fn is_fin(&self) -> bool { self.flags & TCP_FIN != 0 }
    pub fn is_rst(&self) -> bool { self.flags & TCP_RST != 0 }
}

impl UdpHeader {
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 8 {
            return None;
        }
        let src_port = u16::from_be_bytes([data[0], data[1]]);
        let dst_port = u16::from_be_bytes([data[2], data[3]]);
        let length = u16::from_be_bytes([data[4], data[5]]);
        let checksum = u16::from_be_bytes([data[6], data[7]]);
        Some(UdpHeader { src_port, dst_port, length, checksum })
    }
}

/// Connection key identifies a unique TCP/UDP flow
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnKey {
    pub src_ip: String,
    pub dst_ip: String,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
}
