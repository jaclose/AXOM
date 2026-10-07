# Wave 2 · Journal desk and Library (PLAN v1)

Branch `feat/wave2-journal-library`, cut from `main` after Wave 1.1. Owner: Claude. Sources: JD's Wave 2 go-ahead (after-setup E and H), IDEAS-1/3 journal and library items, MANIFEST section C.

## Goal

Journal makes someone want to come back: an overhead desk where the notebook is the centre and the ritual is calm. The Library turns scattered links and files into shelves you can browse.

## Scope (v1)

1. **Experience architecture first.** Desk scene (notebook centred; laptop, headphones, plant, drink, iPad, light and weather as quiet context) built as layers that can grow, not dozens of decorative objects now.
2. **Journal setup.** Have you journaled before; free write, prompts or mixed; tone of feedback; desk and notebook look.
3. **Writing and closing.** Elegant close animation, the day marked as logged; catch-up for missed days that separates recent days from days too old to remember accurately.
4. **Integration.** Day activity, energy, course work and reflections flow into the entry; the week feeds Wrapped (branch `feat/wave2-home`).
5. **Safety.** No diagnoses from journal text. Concerning self-harm language shows professional crisis resources, the student's own trusted contact, emergency guidance, in a calm supportive layout. No developer contact anywhere, ever.
6. **Library.** Shelves, folders, files, saved journal pages, templates; import from the student's own files; nothing copyrighted or private ships in the public repo; no iWallpaper assets without a licence.

## Not in v1

AI journaling feedback beyond tone presets; cloud file storage; generated desk art that costs credits (needs JD's approval).

## Verification

verify:all; unit tests for catch-up windows and the safety classifier's boundaries (crisis copy only, no diagnosis text); renders at 1440/390, dark/light, reduced motion; e2e for write -> close -> catch-up -> reload.

## Coordination

Journal and library are Claude's lane. Energy data is shared; read it, do not reshape it.

## Open decisions for JD

- Desk art direction (illustrated vs photographic vs 3D) and whether any generated assets may use paid credits.
- Default trusted-contact prompt wording.
