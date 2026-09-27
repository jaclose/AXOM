# AXOM Performance Budgets

To maintain a "Snappy" feel regardless of the amount of data (e.g., 50,000+ Anki cards), AXOM adheres to strict performance budgets.

## 1. Time-to-Interactive (TTI)
- **Cold Boot**: < 1.5 seconds.
- **Page Transition**: < 200ms.
- **Search/Filter**: < 50ms (must be perceived as instantaneous).

## 2. The "Big Data" Strategy
When the Local Vault grows, we move from "Read-All" to "Windowed" access.

### Virtualization
- **Card Vault**: Use `react-window` or `virtuoso` for the Anki card list to avoid rendering 1,000+ DOM nodes.
- **Activity History**: Lazy-load logs in chunks of 50.

### Indexing
- **Search Index**: Implement a lightweight `inverted index` for tags and card content, updated on save, to avoid `O(n)` string searches on every keystroke.

## 3. Memory Management
- **State Pruning**: Clear transient session state on `unload`.
- **AI Buffering**: Limit AI response streaming to prevent memory leaks in the `SesssionOverlay`.
