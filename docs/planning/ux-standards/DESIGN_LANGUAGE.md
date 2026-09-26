# AXOM UX Standards & Design Language

To ensure a "Premium" feel that scales, all new components must adhere to these standards.

## 1. The "Glass" Philosophy
All main content containers use the `GlassCard` primitive.
- **Transparency**: Background uses `rgba` with `backdrop-filter: blur`.
- **Borders**: 1px solid with low-opacity light/dark accents.
- **Padding**: Standardized `pad` prop for consistent internal spacing.

## 2. Motion & Feedback
Interactions must feel "alive" but not distracting.
- **Transitions**: Use `framer-motion` for page transitions (slide-in, fade-out).
- **Feedback**: Every action (Save, Delete, Log) must trigger a `pushToast` with a specific tone (`success`, `warn`, `info`).
- **Loading States**: Use `Suspense` with a themed skeleton instead of a blank screen.

## 3. Color Semantics
Colors are tied to **Intent**, not just aesthetics.
- **Cyan**: Information / Primary Guidance / Pre-med.
- **Purple**: Advanced / Residency / Specialized.
- **Gold**: High-Value / Mastered / Success.
- **Orange**: Warning / In-Progress / Pending.
- **Neutral**: Background / Secondary / Planned.

## 4. Typography Hierarchy
- **Headers**: Poppins (Semi-Bold/Bold).
- **Body**: System Sans (Clean, high-readability for long-form medical text).
- **Mono**: Use `mono` class for version numbers, paths, and code-like data.
