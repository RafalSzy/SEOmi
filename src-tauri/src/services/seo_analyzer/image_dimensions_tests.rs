use super::{
    intrinsic_data_uri_dimensions, percent_decode_data, read_be_u16, read_le_u24,
    svg_data_uri_dimensions,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

fn data_uri(kind: &str, bytes: &[u8]) -> String {
    format!("data:image/{kind};base64,{}", BASE64_STANDARD.encode(bytes))
}

#[test]
fn bounded_readers_and_percent_decoding_reject_truncated_or_invalid_data() {
    assert_eq!(read_be_u16(&[0x12, 0x34], 0), Some(0x1234));
    assert_eq!(read_be_u16(&[0x12], 0), None);
    assert_eq!(read_le_u24(&[1, 2, 3], 0), Some(0x030201));
    assert_eq!(read_le_u24(&[1, 2], 0), None);
    assert_eq!(percent_decode_data("width%3D20"), Some("width=20".into()));
    assert_eq!(percent_decode_data("bad%ZZ"), None);
    assert_eq!(percent_decode_data("bad%FF"), None);
}

#[test]
fn svg_dimensions_support_numeric_attributes_and_safe_fallbacks() {
    assert_eq!(
        svg_data_uri_dimensions(r#"<svg width="120" height="60"></svg>"#),
        Some((120, 60))
    );
    assert_eq!(
        svg_data_uri_dimensions(r#"<svg viewBox="0 0 -1 40"></svg>"#),
        None
    );
    assert_eq!(svg_data_uri_dimensions("<div></div>"), None);

    assert_eq!(
        intrinsic_data_uri_dimensions(&data_uri(
            "svg+xml",
            br#"<svg width="80" height="40"></svg>"#,
        )),
        Some((80, 40))
    );
    assert_eq!(
        intrinsic_data_uri_dimensions("data:image/svg+xml;base64,not-base64"),
        None
    );
    assert_eq!(
        intrinsic_data_uri_dimensions("data:image/svg+xml,bad%FF"),
        None
    );
}

#[test]
fn webp_jpeg_and_unsupported_raster_payloads_are_bounded() {
    let mut webp = vec![0; 30];
    webp[0..4].copy_from_slice(b"RIFF");
    webp[8..12].copy_from_slice(b"WEBP");
    webp[12..16].copy_from_slice(b"VP8X");
    webp[24..27].copy_from_slice(&299u32.to_le_bytes()[..3]);
    webp[27..30].copy_from_slice(&399u32.to_le_bytes()[..3]);
    assert_eq!(
        intrinsic_data_uri_dimensions(&data_uri("webp", &webp)),
        Some((300, 400))
    );

    let jpeg = [0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 3, 0, 2, 0, 0, 0, 0];
    assert_eq!(
        intrinsic_data_uri_dimensions(&data_uri("jpeg", &jpeg)),
        Some((2, 3))
    );
    assert!(
        intrinsic_data_uri_dimensions(&data_uri("jpeg", &[0xff, 0xd8, 0xff, 0xc0, 0, 1])).is_none()
    );
    assert!(intrinsic_data_uri_dimensions("data:image/png;base64,not-base64").is_none());
    assert!(intrinsic_data_uri_dimensions("data:text/plain;base64,AAAA").is_none());
    assert!(intrinsic_data_uri_dimensions("data:image/png").is_none());
}
