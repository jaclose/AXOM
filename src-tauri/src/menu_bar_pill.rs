//! Raycast-style menu bar pill for the focus timer (macOS): the clock in
//! monospaced digits and a `⋯` inside a thin rounded outline, drawn as a
//! template image so macOS tints it for light, dark and tinted menu bars.
#![cfg(target_os = "macos")]

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2_app_kit::{
    NSAttributedStringNSStringDrawing, NSBezierPath, NSColor, NSFont, NSFontAttributeName,
    NSFontWeightMedium, NSForegroundColorAttributeName, NSImage,
};
use objc2_foundation::{
    MainThreadMarker, NSAttributedString, NSDictionary, NSPoint, NSRect, NSSize, NSString,
};

const BAR_HEIGHT: f64 = 22.0;
const PILL_HEIGHT: f64 = 17.0;
const PADDING_X: f64 = 7.0;
const RADIUS: f64 = 4.5;
const FONT_SIZE: f64 = 12.5;

/// Draw `title` inside the rounded outline. Main thread only.
fn render(title: &str) -> Retained<NSImage> {
    let font = NSFont::monospacedDigitSystemFontOfSize_weight(FONT_SIZE, unsafe { NSFontWeightMedium });
    let color = NSColor::blackColor();
    let objects: [Retained<AnyObject>; 2] = [
        Retained::into_super(Retained::into_super(font)),
        Retained::into_super(Retained::into_super(color)),
    ];
    let keys = unsafe { [NSFontAttributeName, NSForegroundColorAttributeName] };
    let attributes = NSDictionary::from_retained_objects(&keys, &objects);
    let text = unsafe { NSAttributedString::new_with_attributes(&NSString::from_str(title), &attributes) };
    let text_size = text.size();
    let width = (text_size.width + PADDING_X * 2.0).ceil();
    let handler = RcBlock::new(move |_: NSRect| -> Bool {
        let top = (BAR_HEIGHT - PILL_HEIGHT) / 2.0;
        let outline = NSRect::new(NSPoint::new(0.5, top + 0.5), NSSize::new(width - 1.0, PILL_HEIGHT - 1.0));
        let path = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(outline, RADIUS, RADIUS);
        path.setLineWidth(1.0);
        NSColor::blackColor().setStroke();
        path.stroke();
        text.drawAtPoint(NSPoint::new(PADDING_X, (BAR_HEIGHT - text_size.height) / 2.0));
        Bool::YES
    });
    let image = NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(width, BAR_HEIGHT), false, &handler);
    image.setTemplate(true);
    image
}

/// Replace the status item's content with the pill. `Ok(false)` means the
/// item is not on screen yet (hidden), so the caller retries on a later tick.
pub fn apply(tray: &tauri::tray::TrayIcon, title: &str) -> tauri::Result<bool> {
    let title = title.to_owned();
    tray.with_inner_tray_icon(move |inner| {
        let (Some(item), Some(mtm)) = (inner.ns_status_item(), MainThreadMarker::new()) else {
            return false;
        };
        let Some(button) = item.button(mtm) else {
            return false;
        };
        let image = render(&title);
        button.setImage(Some(&image));
        button.setTitle(&NSString::from_str(""));
        // Let tray-icon resize its click-tracking view to the new width.
        let _ = inner.set_title(Some(""));
        true
    })
}

#[cfg(test)]
mod tests {
    /// `AXOM_PILL_PNG_DIR=/tmp cargo test --lib renders_pill -- --ignored`
    /// writes the pill as TIFF files for a visual check.
    #[test]
    #[ignore]
    fn renders_pill() {
        let dir = std::env::var("AXOM_PILL_PNG_DIR").unwrap_or_else(|_| std::env::temp_dir().display().to_string());
        for (name, title) in [("focus", "24:13  ⋯"), ("paused", "‖ 12:30  ⋯"), ("break", "Break 04:59  ⋯")] {
            let image = super::render(title);
            let data = image.TIFFRepresentation().expect("tiff");
            let bytes = data.to_vec();
            std::fs::write(format!("{dir}/pill-{name}.tiff"), bytes).expect("write");
        }
    }
}
