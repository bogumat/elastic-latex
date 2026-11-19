use crate::projects::{Project, Result};
use std::{fs, io::Write};

pub fn save(project: &Project, bytes: &[u8]) -> Result<String> {
    if bytes.len() > 20 * 1024 * 1024
        || bytes.len() < 24
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[12..16] != b"IHDR"
    {
        return Err("Expected a PNG image smaller than 20 MiB.".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as u64;
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as u64;
    if width == 0 || height == 0 || width * height > 32 * 1024 * 1024 {
        return Err("Clipboard images must be smaller than 32 megapixels.".into());
    }
    match fs::create_dir(project.root.join("images")) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let folder = project.resolve("images")?;
    let mut file = tempfile::Builder::new()
        .prefix("pasted-")
        .suffix(".png")
        .tempfile_in(folder)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    let (_, path) = file.keep().map_err(|error| error.to_string())?;
    Ok(format!(
        "images/{}",
        path.file_name().unwrap().to_string_lossy()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = include_bytes!("../icons/icon.png");

    #[test]
    fn saves_unique_images_without_overwriting() {
        let folder = tempfile::tempdir().unwrap();
        let project = Project::open(folder.path()).unwrap();
        let first = save(&project, PNG).unwrap();
        let second = save(&project, PNG).unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with("images/pasted-"));
        assert_eq!(fs::read(project.resolve(&first).unwrap()).unwrap(), PNG);
        assert!(save(&project, b"not an image").is_err());
        let mut oversized = PNG.to_vec();
        oversized[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(save(&project, &oversized).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_images_folder_outside_project() {
        let folder = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.path().join("images")).unwrap();
        assert!(save(&Project::open(folder.path()).unwrap(), PNG).is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}
