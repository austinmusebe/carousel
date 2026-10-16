#[cfg(target_os = "windows")]
pub fn capture_monitor_thumbnail(x: i32, y: i32, width: i32, height: i32) -> Option<String> {
    use base64::Engine;
    use std::io::Cursor;
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, SRCCOPY,
    };

    if width <= 0 || height <= 0 {
        return None;
    }

    // Scale to high quality 1280px width (clean downsample with full color fidelity)
    let scale = (width as f64 / 1280.0).max(1.0);
    let target_w = (width as f64 / scale).round() as i32;
    let target_h = (height as f64 / scale).round() as i32;

    unsafe {
        let hdc_screen = GetDC(null_mut());
        if hdc_screen.is_null() {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(null_mut(), hdc_screen);
            return None;
        }

        let hbm = CreateCompatibleBitmap(hdc_screen, target_w, target_h);
        if hbm.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);
            return None;
        }

        let old_bm = SelectObject(hdc_mem, hbm);

        // HALFTONE mode ensures proper bilinear/bicubic color averaging instead of nearest-neighbor pixel dropping
        SetStretchBltMode(hdc_mem, HALFTONE);
        SetBrushOrgEx(hdc_mem, 0, 0, null_mut());

        // Hardware-accelerated GDI blit & downsample
        let blt_res = StretchBlt(
            hdc_mem,
            0,
            0,
            target_w,
            target_h,
            hdc_screen,
            x,
            y,
            width,
            height,
            SRCCOPY,
        );

        if blt_res == 0 {
            SelectObject(hdc_mem, old_bm);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);
            return None;
        }

        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: target_w,
                biHeight: -target_h, // Negative for top-down raster scan
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows_sys::Win32::Graphics::Gdi::RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }; 1],
        };

        let mut raw_bytes = vec![0u8; (target_w * target_h * 4) as usize];
        let get_di_res = GetDIBits(
            hdc_mem,
            hbm,
            0,
            target_h as u32,
            raw_bytes.as_mut_ptr() as *mut _,
            &mut bi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_bm);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(null_mut(), hdc_screen);

        if get_di_res == 0 {
            return None;
        }

        // Convert BGRA to RGB
        let pixel_count = (target_w * target_h) as usize;
        let mut rgb_bytes = Vec::with_capacity(pixel_count * 3);
        for i in 0..pixel_count {
            let b = raw_bytes[i * 4];
            let g = raw_bytes[i * 4 + 1];
            let r = raw_bytes[i * 4 + 2];
            rgb_bytes.push(r);
            rgb_bytes.push(g);
            rgb_bytes.push(b);
        }

        let mut buf = Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 88);
        if encoder
            .encode(
                &rgb_bytes,
                target_w as u32,
                target_h as u32,
                image::ExtendedColorType::Rgb8,
            )
            .is_err()
        {
            return None;
        }

        Some(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
    }
}
