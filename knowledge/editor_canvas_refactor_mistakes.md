# Refactoring Mistakes Catalog (UI Canvas)

> Project-agnostic mistakes observed during UI canvas refactors.
> Each entry captures: Symptom → Root cause → Fix → Prevention → Detection.

---

## Format
- **Symptom**: What you see in the UI/logs
- **Root cause**: Why it happened
- **Fix**: Specific change that resolved it
- **Prevention**: How to avoid it next time
- **Detection**: Quick way to notice early

---

## Mistake Entries

### M1. Template binding broken after state move
- **Symptom:** Selection box or state-driven UI stops updating after moving state into a hook.
- **Root cause:** Template still references old state path instead of the hook state.
- **Fix:** Update template bindings to the new state owner (e.g., `gestures.state.isSelecting`).
- **Prevention:** Grep templates for state keys before/after moving state.
- **Detection:** UI element fails to render; console shows undefined property access.

### M2. Click event clears selection after mouseup
- **Symptom:** Box selection appears to work but selection is immediately cleared.
- **Root cause:** `click` fires after `mouseup` and clears selection.
- **Fix:** Guard with `_justCompletedSelection` + `setTimeout(0)` to skip click handler.
- **Prevention:** Document event order (mousedown → mousemove → mouseup → click) in gesture code.
- **Detection:** Selection flashes then disappears on mouse release.

### M3. Boolean return from gesture handler is insufficient
- **Symptom:** Pan/selection logic is misclassified, causing wrong post-gesture behavior.
- **Root cause:** `handleMouseUp()` returns `true/false` for multiple gesture types.
- **Fix:** Return explicit gesture identifiers (`"pan"`, `"selection"`, `null`).
- **Prevention:** Use enums/strings for gesture states, not booleans.
- **Detection:** Selection guard triggers during pan, or vice versa.

### M4. Hook missing required callbacks
- **Symptom:** Viewport/selection updates silently stop working after extraction into hook.
- **Root cause:** Hook dependencies (callbacks) were not passed/injected.
- **Fix:** Add explicit hook parameters (`clearSelection`, `onViewRectUpdate`, etc.).
- **Prevention:** Define hook interface contract in the hook file and keep it stable.
- **Detection:** Hook logs or errors show `undefined is not a function`.

### M5. Grep search returned empty (case sensitivity)
- **Symptom:** A function seems missing and changes are not applied.
- **Root cause:** Case-sensitive search missed matches on Windows/PowerShell.
- **Fix:** Use `Select-String` or case-insensitive search.
- **Prevention:** Standardize search patterns (case-insensitive by default).
- **Detection:** Search returns no results but IDE navigation can still find symbols.

### M6. Debug logs left in production
- **Symptom:** Console noise and performance overhead in dev builds.
- **Root cause:** Temporary `console.log` statements were not removed.
- **Fix:** Remove debug logs after confirming behavior.
- **Prevention:** Add a pre-commit “log cleanup” checklist.
- **Detection:** Unexpected console spam during normal usage.

### M7. OWL reactivity assumption about new Set()
- **Symptom:** UI does not re-render even though a getter returns a new Set.
- **Root cause:** OWL tracks property access, not return-value identity.
- **Fix:** Store reactive state and mutate tracked properties directly.
- **Prevention:** Avoid reactivity-by-return-value patterns.
- **Detection:** State changes visible in logs but not in the DOM.

---

## Validated Practices

### P1. Browser verification for timing bugs
- **Why:** Automated tests miss event-order issues.
- **Use:** Always do a quick real-browser smoke test for gestures.

### P2. Debug with small, targeted logs
- **Why:** Quick visibility of event order and state flow.
- **Use:** Add minimal logs at entry/exit of handlers, then remove.

### P3. Document event bubbling order
- **Why:** Prevents selection/pan guards from fighting each other.
- **Use:** Keep event order notes near the gesture handlers.
