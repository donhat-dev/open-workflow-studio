# Deep Patterns (Framework-agnostic)

> Tài liệu chuyên sâu về các pattern phức tạp; trình bày theo hướng project-less.
> Nguồn tham khảo chính: lf_web_studio (Odoo 18) và các framework UI phổ biến.

---

## Format & usage
- **Problem → Solution → Use when → Avoid when → Recipe → Pitfalls → References**
- Ưu tiên mô tả logic thuần, tránh ràng buộc framework nếu không cần.

---

## 1. Hook Factory Pattern

**Applicability**
- **Use when:** You want framework-agnostic core logic with thin framework wrappers.
- **Avoid when:** Logic is tiny and unlikely to be reused.
- **Pitfalls:** Over-abstraction can hide necessary framework hooks.

### 1.1 Vấn Đề
Bạn có logic drag-and-drop phức tạp (1000+ lines) cần hoạt động với OWL. Nhưng:
- Không muốn core logic phụ thuộc OWL
- Muốn dùng lại logic cho React, Vue, hoặc vanilla JS sau này

### 1.2 Giải Pháp: makeDraggableHook
Tách thành 2 layers:
1. **Core logic** (framework-agnostic) - 1077 lines
2. **OWL wrapper** (framework-specific) - 25 lines

**File: `draggable_hook_builder_owl.js` (25 lines)**
```javascript
import { onWillUnmount, reactive, useEffect, useExternalListener } from "@odoo/owl";
import { makeDraggableHook as nativeMakeDraggableHook } from "./draggable_hook_builder";

export function makeDraggableHook(params) {
    return nativeMakeDraggableHook({
        ...params,
        setupHooks: {
            addListener: useExternalListener,  // OWL hook
            setup: useEffect,                   // OWL hook
            teardown: onWillUnmount,           // OWL hook
            throttle: useThrottleForAnimation,
            wrapState: reactive,               // OWL reactive
        },
    });
}
```

**File: `draggable_hook_builder.js` (1077 lines - NO OWL IMPORTS)**
```javascript
export function makeDraggableHook(hookParams) {
    const { setupHooks } = hookParams;  // Nhận primitives từ wrapper

    return {
        [hookParams.name](params) {
            const state = setupHooks.wrapState({ dragging: false });

            setupHooks.setup(() => {
                // Setup logic
                return () => { /* cleanup */ };
            });

            setupHooks.addListener(window, "pointermove", onPointerMove);
            setupHooks.teardown(() => cleanup());

            return state;
        }
    };
}
```

### 1.3 Lợi Ích
- Core logic testable mà không cần OWL
- Dễ port sang framework khác
- OWL wrapper siêu nhẹ

---

## 2. Cleanup Manager Pattern

**Applicability**
- **Use when:** Multiple DOM mutations need guaranteed cleanup.
- **Avoid when:** No side effects or the lifecycle is already managed elsewhere.
- **Pitfalls:** Forgetting to register cleanup for every side effect.

### 2.1 Vấn Đề
Khi drag element:
- Add class `o_dragged`
- Add style `position: fixed`
- Add event listeners
- Modify attributes

**Khi drag kết thúc phải cleanup TẤT CẢ.** Quên cleanup = bug.

### 2.2 Giải Pháp: makeCleanupManager
Mỗi side effect đăng ký cleanup function ngay khi được tạo.

```javascript
function makeCleanupManager(defaultCleanupFn) {
    const cleanups = [];

    return {
        add(cleanupFn) {
            if (typeof cleanupFn === "function") {
                cleanups.push(cleanupFn);
            }
        },
        cleanup() {
            while (cleanups.length) {
                cleanups.pop()();  // Execute từng cleanup
            }
            this.add(defaultCleanupFn);  // Reset về default
        },
    };
}
```

### 2.3 Sử Dụng
```javascript
const cleanup = makeCleanupManager(() => console.log("Reset"));

// Mỗi mutation đăng ký cleanup
element.classList.add("dragged");
cleanup.add(() => element.classList.remove("dragged"));

element.style.position = "fixed";
cleanup.add(() => element.style.position = "");

// Khi drag kết thúc
cleanup.cleanup();  // Tự động remove class, reset style
```

---

## 3. DOM Helpers Pattern

**Applicability**
- **Use when:** Repeated DOM mutations need consistent cleanup.
- **Avoid when:** DOM changes are minimal and easy to revert manually.
- **Pitfalls:** Helpers masking direct DOM access during debugging.

### 3.1 Vấn Đề
Viết cleanup cho mỗi DOM operation rất cồng kềnh:
```javascript
element.classList.add("dragged");
cleanup.add(() => element.classList.remove("dragged"));

element.style.width = "100px";
cleanup.add(() => element.style.width = "");
```

### 3.2 Giải Pháp: makeDOMHelpers
Wrap DOM operations để auto-register cleanup.

```javascript
function makeDOMHelpers(cleanup) {
    return {
        addClass(el, ...classNames) {
            cleanup.add(() => el.classList.remove(...classNames));
            el.classList.add(...classNames);
        },

        addStyle(el, style) {
            cleanup.add(saveAttribute(el, "style"));  // Save cũ trước
            for (const key in style) {
                el.style.setProperty(key, style[key]);
            }
        },

        addListener(el, event, callback, options) {
            el.addEventListener(event, callback, options);
            cleanup.add(() => el.removeEventListener(event, callback, options));
        },

        setAttribute(el, attr, value) {
            cleanup.add(saveAttribute(el, attr));
            el.setAttribute(attr, value);
        },
    };
}
```

### 3.3 saveAttribute Helper
```javascript
function saveAttribute(el, attribute) {
    const hasAttribute = el.hasAttribute(attribute);
    const originalValue = el.getAttribute(attribute);

    return () => {
        if (hasAttribute) {
            el.setAttribute(attribute, originalValue);
        } else {
            el.removeAttribute(attribute);
        }
    };
}
```

### 3.4 Sử Dụng Simplified
```javascript
const cleanup = makeCleanupManager();
const dom = makeDOMHelpers(cleanup);

// Không cần viết cleanup thủ công!
dom.addClass(element, "dragged", "highlight");
dom.addStyle(element, { position: "fixed", width: "100px" });
dom.addListener(window, "pointermove", onMove);

// Cleanup tự động:
cleanup.cleanup();
```

---

## 4. Thin Component Strategy

**Applicability**
- **Use when:** You want predictable, testable UI components.
- **Avoid when:** Component is truly small and self-contained.
- **Pitfalls:** Moving too much into hooks without clear boundaries.

### 4.1 Quy Tắc
- Component < 150 lines
- Chỉ chứa: template binding, refs, delegation
- Logic nằm trong Hook hoặc Model

### 4.2 Ví Dụ: ViewEditor (114 lines)
```javascript
export class ViewEditor extends Component {
    static template = "lf_web_studio.ViewEditor";
    static components = { StudioView, InteractiveEditor, ViewXmlEditor };

    setup() {
        // Services
        this.studio = useService("studio");

        // Refs
        this.rootRef = useRef("root");
        this.rendererRef = useRef("viewRenderer");

        // Model từ hook - TẤT CẢ logic ở đây
        this.viewEditorModel = useViewEditorModel(this.rendererRef, { initialState });
    }

    // Thin delegation methods
    onSaveXml({ resourceId, oldCode, newCode }) {
        this.viewEditorModel.doOperation({
            type: "replace_arch",
            viewId: resourceId,
            oldArch: oldCode,
            newArch: newCode,
        });
    }
}
```

### 4.3 So Sánh
| Component              | Hook                          | Model                       |
| ---------------------- | ----------------------------- | --------------------------- |
| ViewEditor (114 lines) | useViewEditorModel (78 lines) | ViewEditorModel (863 lines) |

**98% logic nằm trong Model, không phải Component.**

---

## 5. Reactive Base Class

**Applicability**
- **Use when:** You need a stateful model with consistent reactivity and escape hatch.
- **Avoid when:** Stateless helpers or pure data containers.
- **Pitfalls:** Hidden reactive subscriptions causing unexpected re-renders.

### 5.1 Pattern
```javascript
export class Reactive {
    constructor() {
        const raw = this;
        this.raw = () => raw;  // Escape hatch
        return reactive(this);
    }
}
```

### 5.2 Tại Sao Cần `.raw()`
Khi đọc từ reactive object, OWL subscribe caller. Đôi khi bạn chỉ muốn đọc mà không subscribe:

```javascript
class EditorOperations extends Reactive {
    _prepare(mode) {
        const raw = this.raw();  // Đọc không subscribe
        const lock = raw._lock;

        if (lock && lock !== mode) {
            // Check internal state
            return false;
        }

        this._lock = mode;  // Write vẫn qua reactive
        return true;
    }
}
```

---

## 6. Operation Stack Pattern (Undo/Redo)

### 6.1 Class Structure
```javascript
export class EditorOperations extends Reactive {
    constructor(params) {
        super();
        this.operations = [];      // Đã commit
        this.undone = [];          // Đã undo (cho redo)
        this.pending = null;       // Đang xử lý
        this.pendingUndone = null;
        this._lock = "";           // "do" | "undo" | "redo"
        this._keepLast = markRaw(new KeepLast());  // Concurrency

        this._callbacks = {
            do: params.do,
            onError: params.onError,
            onDone: params.onDone,
        };
    }

    get canUndo() {
        return this.operations.length > 0 || this.pending?.length > 0;
    }

    get canRedo() {
        return this.undone.length > 0 || this.pendingUndone?.length > 0;
    }
}
```

### 6.2 Do Operation
```javascript
async do(op, silent = false) {
    if (!this._prepare("do") || !op) {
        this._close();
        return;
    }

    this.pending.push(op);
    this.pendingUndone = [];  // Clear redo stack

    let done = {};
    if (!silent) {
        done = await this._do("do", this.pending, op);
    } else {
        done = { result: true };
    }

    this._close(done);
}
```

### 6.3 Undo
```javascript
async undo(canRedo = true) {
    if (!this._prepare("undo")) {
        this._close();
        return;
    }

    const ops = this.raw().pending;
    if (!ops?.length) {
        this._close();
        return;
    }

    const op = ops.pop();  // Lấy op cuối
    if (canRedo) {
        this.pendingUndone.push(op);  // Push vào redo stack
    }

    const done = await this._do("undo", this.pending, op);
    this._close(done);
}
```

---

## 7. Snackbar Indicator Pattern

### 7.1 Vấn Đề
Nhiều async operations chạy cùng lúc. Muốn hiển thị 1 loading indicator cho tất cả.

### 7.2 Giải Pháp
```javascript
export class SnackbarIndicator extends Reactive {
    constructor() {
        super();
        this.state = "";  // "" | "loading" | "loaded" | "error"
        this.pending = null;
        this.keepLast = markRaw(new KeepLast());
    }

    add(prom) {
        this.state = "loading";

        const raw = this.raw();
        this.pending = Promise.all([raw.pending, prom]);

        this.keepLast.add(raw.pending)
            .then(() => this.state = "loaded")
            .catch(() => this.state = "error")
            .finally(() => this.pending = null);

        return prom;  // Pass through để caller await
    }
}
```

### 7.3 Sử Dụng
```javascript
const snackbar = new SnackbarIndicator();

// Multiple operations
snackbar.add(saveOperation1());
snackbar.add(saveOperation2());
snackbar.add(saveOperation3());

// UI binds to snackbar.state
// "loading" → "loaded" (hoặc "error")
```

---

## 8. Position Hook Pattern

### 8.1 Vấn Đề
Dropdown menu phải stay positioned relative to button, ngay cả khi:
- User scroll
- Window resize
- DOM thay đổi

### 8.2 Giải Pháp: usePosition
```javascript
export function usePosition(refName, getTarget, options = {}) {
    const ref = useRef(refName);
    let lock = false;

    const update = () => {
        const targetEl = getTarget();
        if (!ref.el || !targetEl?.isConnected || lock) return;

        const solution = reposition(ref.el, targetEl, options);
        options.onPositioned?.(ref.el, solution);
    };

    // Batched updates via shared bus
    const component = useComponent();
    const bus = component.env[POSITION_BUS] || new EventBus();

    bus.addEventListener("update", batchedUpdate);
    onWillDestroy(() => bus.removeEventListener("update", batchedUpdate));

    // Topmost hook attaches scroll/resize listeners
    if (!(POSITION_BUS in component.env)) {
        useChildSubEnv({ [POSITION_BUS]: bus });

        useEffect(() => {
            document.addEventListener("scroll", throttledUpdate, { capture: true });
            window.addEventListener("resize", throttledUpdate);
            return () => {
                document.removeEventListener("scroll", throttledUpdate, { capture: true });
                window.removeEventListener("resize", throttledUpdate);
            };
        });
    }

    return {
        lock: () => lock = true,
        unlock: () => { lock = false; bus.trigger("update"); },
    };
}
```

### 8.3 Shared Bus Pattern
Nhiều positioned elements share 1 EventBus. Khi scroll:
1. Topmost hook trigger bus
2. Tất cả subscribers update position
3. Batched để tránh layout thrashing

---

## 9. Services Override Pattern

### 9.1 Use Case
Component cần local version của service với custom behavior.

### 9.2 Implementation
```javascript
export function useServicesOverrides(overrides) {
    let env = useEnv();

    // Create new services object inheriting from parent
    const services = Object.create(env.services);
    useSubEnv({ services });

    env = useEnv();  // Re-get với new services

    // Topological sort để respect dependencies
    const getDeps = (name) => overrides[name]?.dependencies || [];
    const topoSorted = topologicalSort(Object.keys(overrides), getDeps);

    for (const servName of topoSorted) {
        services[servName] = overrides[servName].start(env, services);
    }
}
```

### 9.3 Ví Dụ
```javascript
setup() {
    useServicesOverrides({
        modifiedOrm: {
            dependencies: ["orm"],
            start(env, services) {
                return {
                    ...services.orm,
                    call: async (...args) => {
                        console.log("Intercepted ORM call");
                        return services.orm.call(...args);
                    },
                };
            },
        },
    });
}
```

---

## 10. Áp Dụng Cho EditorCanvas

### Các Hooks Cần Tạo

| Hook                 | Trách Nhiệm                        | ~Lines |
| -------------------- | ---------------------------------- | ------ |
| `useViewport`        | Zoom, pan, fit-to-view             | 100    |
| `useNodeDrag`        | Drag nodes, snap to grid           | 150    |
| `useConnection`      | Draw connections, temp connections | 150    |
| `useBoxSelect`       | Box selection logic                | 80     |
| `useCanvasShortcuts` | Keyboard shortcuts                 | 50     |

### Refactor Plan
```
editor_canvas/
├── editor_canvas.js         # Component (< 150 lines)
├── editor_canvas_hook.js    # Main hook
├── hooks/
│   ├── use_viewport.js
│   ├── use_node_drag.js
│   ├── use_connection.js
│   ├── use_box_select.js
│   └── use_shortcuts.js
├── utils/
│   ├── geometry.js          # Pure: contains, intersects
│   ├── connection_path.js   # Pure: bezier calculations
│   └── grid_snap.js         # Pure: snap logic
└── editor_canvas_model.js   # Optional nếu cần
```
