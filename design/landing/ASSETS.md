# AXOM landing assets

Original AXOM sculpture, created locally in Blender 5.2.2. No stock assets, private
course material, paid generation, or third-party model files. Brand mark and Poppins
fonts reuse the existing application. This source and its rendered derivatives can
be distributed with AXOM.

## Current fallback

`web/public/landing/orbit-*`: original ray-traced titanium armillary, machined gimbals,
polyhedral lattice and faceted optical core, cold silver/lavender studio lighting.
A static sculpture with subtle periodic camera drift; it is **not an AI-generated
rotating-sculpture film**. Eight seconds, 24 fps, no audio. The zoom function closes
on a 192-frame period without a duplicated endpoint. Mobile gets a cropped WebP
poster and a 720p WebM. Full MP4 is the codec fallback.

Render with `blender --background --threads 4 --python scripts/render-landing-orbit.py -- /absolute/output`.
GPU rendering stalled on the authoring machine, so the reproducible default is CPU.
The optional `animate` argument renders the full cyclic 3D rig; it was not used for
the shipped fallback. The editable `.blend` file is emitted into the output folder.

Encode with `sh scripts/encode-landing-orbit.sh /absolute/output/poster.png`.
Requires ffmpeg with libx264/libvpx-vp9 and cwebp. No new app dependencies.

## Approved Higgsfield replacement prompt

Eight-second 16:9 1920x1080 silent luxury scientific hero film. A near-black obsidian
world. An intricate suspended sculpture of precision-machined brushed titanium,
optical glass and thin illuminated orbital rings occupies the right 45 percent.
Keep the entire left 55 percent dark, calm and empty for live website typography.
Faceted crystalline core, delicate structural connections, convincing physical
reflections. Restrained silver, cold blue and pale lavender grazing lights. Locked
orthographic-feeling 60mm camera. Almost imperceptible cyclic orbital motion with a
matching start/end pose, continuous lighting, no cuts or camera jump. Museum object
photography, restrained luxury engineering. No text, logo, watermark, people,
medical symbols, neon tunnel, lens-flare bursts, smoke over the text area, or sound.

Prefer identical start/end reference frames if the selected model supports them.
Inspect the actual first/last frames and motion before replacing the fallback;
a generated prompt alone never proves a seamless loop. Re-encode all three variants
and verify the poster, autoplay-denied, reduced-motion and data-saver paths.

Higgsfield checked 2026-10-11: Free, 0 spendable credits, pending credits trial with
100 reported trial credits and unlimited unavailable. A remaining 480p motion-transfer
grant does not meet this 1080p text-to-video brief. No job submitted or trial activated.
