use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SystemParametersInfoW,
};

pub fn set_wallpaper(path: &str) -> Result<String, String> {
    // Resolve to absolute path
    let abs_path = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(e) => return Err(format!("Failed to resolve path '{}': {}", path, e)),
    };

    // Verify the file exists
    if !abs_path.is_file() {
        return Err(format!("Path is not a file: {}", abs_path.display()));
    }

    // Convert to null-terminated wide string
    // canonicalize on Windows returns \\?\C:\... prefix, strip it for SystemParametersInfoW
    let path_str = abs_path.to_string_lossy();
    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();
    let mut wide: Vec<u16> = OsStr::new(&clean_path).encode_wide().collect();
    wide.push(0);

    let result = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_ptr() as *mut core::ffi::c_void,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };

    if result != 0 {
        Ok(clean_path)
    } else {
        Err(format!(
            "SystemParametersInfoW failed: {}",
            std::io::Error::last_os_error()
        ))
    }
}
