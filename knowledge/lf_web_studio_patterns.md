# Component Architecture Patterns (Framework-agnostic)

> Tài liệu tổng hợp các pattern kiến trúc theo hướng project-less.
> Nguồn tham khảo chính: lf_web_studio (Odoo 18), dùng như reference để rút ra nguyên tắc chung.

---

## Format & usage
- **Problem → Solution → Use when → Avoid when → Recipe → Pitfalls → References**
- Ví dụ ngắn gọn, ưu tiên tính áp dụng rộng.

---

## 1. Service Layer Patterns

**Applicability**
- **Use when:** UI needs a single source of truth and controlled mutations.
- **Avoid when:** Data is purely derived or stateless (prefer pure functions).
- **Pitfalls:** Hidden mutable state without explicit update signals.

### 1.1 Pattern: Đóng Gói State trong Service
**Mô tả:** Service giữ state nội bộ (`state` object), chỉ expose getters và methods. Components không được phép mutate state trực tiếp.

**Ví dụ từ `studio_service.js`:**
```javascript
// state nội bộ - KHÔNG export
const state = {
    studioMode: null,
    editedViewType: null,
    editedAction: null,
    editorTab: "views",
};

// Chỉ expose getters
return {
    get mode() { return state.studioMode; },
    get editedAction() { return state.editedAction; },
    setParams(params) { /* mutate state */ },
};
```

**Lợi ích:**
- Ngăn components tự ý thay đổi state
- Dễ debug vì mọi mutation đi qua methods
- Dễ thêm validation/side effects

---

### 1.2 Pattern: EventBus cho State Updates
**Mô tả:** Service tạo EventBus nội bộ và trigger events khi state thay đổi. Components subscribe để react.

**Ví dụ:**
```javascript
const bus = new EventBus();

function setParams(params) {
    Object.assign(state, params);
    bus.trigger("UPDATE", { reset: true });  // Notify subscribers
}

return { bus, setParams, ... };
```

**Usage trong component:**
```javascript
setup() {
    const studio = useService("studio");
    studio.bus.addEventListener("UPDATE", () => this.render());
}
```

---

### 1.3 Pattern: Reactive Service Hook
**Mô tả:** Cung cấp hook `useXxxAsReactive()` wrap service getters trong `useState()` để components reactive track state.

**Ví dụ từ `studio_service.js`:**
```javascript
export function useStudioServiceAsReactive() {
    const studio = useService("studio");
    const state = useState({ ...studio });  // Copy vào reactive object
    state.requestId = 1;

    function onUpdate({ detail }) {
        Object.assign(state, studio);  // Sync khi UPDATE
        if (detail.reset) state.requestId++;
    }

    studio.bus.addEventListener("UPDATE", onUpdate);
    onWillUnmount(() => studio.bus.removeEventListener("UPDATE", onUpdate));

    return state;
}
```

**Khi nào dùng:** Component cần re-render khi service state thay đổi.

---

## 2. Hook Patterns

**Applicability**
- **Use when:** You need lifecycle wiring + dependency injection around a model.
- **Avoid when:** Logic is pure or can be placed in utils without OWL hooks.
- **Pitfalls:** Hook recreates model every render (unstable identity).

### 2.1 Pattern: Hook Tạo Model + useSubEnv
**Mô tả:** Hooks khởi tạo domain Model class và inject vào env qua `useSubEnv()`. Return `useState(model)` cho reactivity.

**Ví dụ từ `view_editor_hook.js`:**
```javascript
export function useViewEditorModel(viewRef, { initialState }) {
    const env = useEnv();

    // Thu thập services
    const services = {
        orm: useService("orm"),
        ui: useService("ui"),
        dialog: { add: useOwnedDialogs() },
    };

    // Tạo Model instance
    const viewEditorModel = new ViewEditorModel({
        env, services, viewRef, initialState,
    });

    // Inject để children access được
    useSubEnv({ viewEditorModel });

    // Lifecycle bindings
    onWillStart(() => viewEditorModel.load());
    onWillDestroy(() => viewEditorModel.isInEdition = false);

    return useState(viewEditorModel);  // Reactive
}
```

**Tại sao pattern này tốt:**
- Model không phụ thuộc component lifecycle
- Hook handles lifecycle, Model giữ logic
- Dễ test Model độc lập

---

### 2.2 Pattern: Services Collection trong Hook
**Mô tả:** Hook thu thập các services cần thiết vào plain object cho Model constructor. Tránh Model phụ thuộc component.

```javascript
const services = Object.fromEntries(
    ["orm", "ui", "notification"].map(sName => [sName, useService(sName)])
);
services.dialog = { add: useOwnedDialogs() };
```

---

### 2.3 Pattern: Lifecycle Binding trong Hook
**Mô tả:** Hook handle `onWillStart`, `onWillDestroy`, `onMounted`. Model giữ pure.

**Ví dụ từ `approval_hook.js`:**
```javascript
export function useApproval({ getRecord, method, action }) {
    const protectedOrm = useService("orm");      // Protected version
    const unprotectedOrm = useEnv().services.orm; // Direct access

    const approval = reactive(
        Object.assign(Object.create(baseApproval), {
            orm: unprotectedOrm,  // Dùng unprotected lúc đầu
        })
    );

    onMounted(() => {
        approval.orm = protectedOrm;  // Chuyển sang protected sau mount
    });

    return approval;
}
```

**Lý do:** Setup hooks có thể chạy trước component mount. Nếu component bị destroy sớm, protected ORM sẽ reject promises.

---

## 3. Quy Tắc Tách Utils

**Applicability**
- **Use when:** Logic is deterministic, reusable, and framework-agnostic.
- **Avoid when:** Logic requires OWL hooks or environment access.
- **Pitfalls:** Sneaking side effects into utils.

### 3.1 Pure Functions → utils.js
**Tiêu chí:** Hàm không có side effects, không phụ thuộc component, chỉ input/output.

**Ví dụ:**
```javascript
// ✅ Pure utils
export function topologicalSort(elems, getDeps) { ... }
export function memoizeOnce(callback) { ... }
export function getFieldsInArch(xmlDoc) { ... }
export function randomString(length) { ... }

// ❌ KHÔNG phải pure utils (dùng hooks)
export function useDialogConfirmation(...) { ... }  // → Hook file
```

---

### 3.2 Hook Functions → *_hook.js hoặc utils.js với prefix use
**Tiêu chí:** Hàm sử dụng OWL hooks (`useService`, `useState`, `useEnv`). LUÔN đặt tên `useXxx()`.

**File organization:**
```
view_editor/
├── view_editor_hook.js      # Hooks cho view editor
├── view_editor_model.js     # Model class
├── view_editor.js           # Component (thin)
├── operations_utils.js      # Pure operation helpers
```

---

### 3.3 Constants → Top-level utils.js
**Mô tả:** Static data arrays, domain-specific constants export từ module root.

```javascript
// utils.js
export const COLORS = ["#FFFFFF", "#262c34", ...];
export const BG_COLORS = ["#FFFFFF", "#1abc9c", ...];
export const SUPPORTED_VIEW_TYPES = { form: "Form", kanban: "Kanban", ... };
```

---

### 3.4 Domain Logic → Model Class
**Mô tả:** Logic phức tạp với state + behavior đóng gói trong class extending `Reactive`.

**Ví dụ:** `ViewEditorModel` (863 lines), `StudioApproval`, `EditionFlow`

---

## 4. Model Class Patterns

**Applicability**
- **Use when:** Domain logic is complex and stateful; needs testability.
- **Avoid when:** State is trivial or can live directly in a service.
- **Pitfalls:** Model owning UI side-effects instead of emitting intents.

### 4.1 Pattern: Extend Reactive Base
**Mô tả:** Models extend `Reactive` class wrap `reactive(this)` trong constructor.

```javascript
export class Reactive {
    constructor() {
        const raw = this;
        this.raw = () => raw;  // Escape hatch - đọc không trigger reactivity
        return reactive(this);
    }
}

// Usage
export class EditionFlow extends Reactive {
    constructor(env, services) {
        super();  // this giờ là reactive
        this.env = env;
        this.breadcrumbs = [];
    }
}
```

**Khi nào dùng `.raw()`:**
- Khi đọc internal state để check, không muốn trigger re-render
- Khi modify internal arrays/objects

---

### 4.2 Pattern: Lazy Initialization
**Mô tả:** Properties set lazily sau construction bởi hook/factory. Giữ constructor đơn giản.

```javascript
class StudioApproval {
    constructor({ getApprovalSpecBatched, model }) {
        this._data = reactive({});
        this.model = model;

        // Lazy - sẽ được set bởi useApproval()
        this.orm = null;
        this.studio = null;
        this.notification = null;
        this.resModel = null;
    }
}
```

---

### 4.3 Pattern: Getters cho Derived State
**Mô tả:** Model dùng getters cho computed properties từ internal state.

```javascript
get dataKey() {
    return buildApprovalKey(this.resModel, this.resId, this.method, this.action);
}

get state() {
    const state = this._getState();
    if (state.rules === null && !state.syncing) {
        this.fetchApprovals();  // Lazy load
    }
    return state;
}
```

---

## 5. File Organization Pattern

**Applicability**
- **Use when:** You want a predictable structure for scaling modules.
- **Avoid when:** The module is tiny and structure adds overhead.
- **Pitfalls:** Splitting files without clear boundaries.

```
lf_web_studio/
├── studio_service.js          # Main service (singleton) - 453 lines
├── utils.js                   # Global pure utils + constants - 79 lines
│
├── client_action/
│   ├── utils.js               # Action-specific utils + hooks - 162 lines
│   │
│   ├── editor/
│   │   └── edition_flow.js    # EditionFlow, EditorOperations classes - 323 lines
│   │
│   └── view_editor/
│       ├── view_editor_hook.js    # Hook tạo Model - 78 lines
│       ├── view_editor_model.js   # Domain model - 863 lines
│       ├── view_editor.js         # Component (thin) - 114 lines
│       └── operations_utils.js    # Pure operation helpers - 22 lines
```

---

## 6. Nguyên Tắc Chính

**Applicability**
- **Use when:** You want consistent architecture across multiple features.
- **Avoid when:** You only need a quick spike/prototype.
- **Pitfalls:** Over-enforcing rules when not yet needed.

### ① Component ← Hook ← Model ← Service
Component dùng Hook → Hook tạo Model → Model dùng Services.
- Component: thin, chỉ binding + refs
- Hook: lifecycle handling
- Model: domain logic
- Service: state management

### ② File Size Guidelines and Rules
| Category   | Target Lines  | Ví dụ                        |
| ---------- | ------------- | ---------------------------- |
| Component  | < 150         | view_editor.js (114)         |
| Hook       | 50-100        | view_editor_hook.js (78)     |
| Model      | 300-900       | ViewEditorModel (863)        |
| Pure Utils | < 50/function | topologicalSort, memoizeOnce |
| Service    | 200-500       | studio_service.js (453)      |

### ③ Naming Conventions
| Type           | Pattern                     | Examples                         |
| -------------- | --------------------------- | -------------------------------- |
| Hook           | `use{Domain}`               | usePosition, useViewEditorModel  |
| Hook Factory   | `make{Behavior}Hook`        | makeDraggableHook                |
| Model          | `{Domain}Model`             | ViewEditorModel                  |
| Reactive Class | `{Domain} extends Reactive` | EditionFlow                      |
| Pure Utils     | verb + noun                 | getFieldsInArch, topologicalSort |
| Service        | `{domain}Service`           | studioService                    |

---

## 7. Example Adaptation Checklist (Workflow Editor)

- Split large canvas logic into focused hooks (viewport, drag, connection).
- Keep the editor component thin; move domain logic into a model/service.
- Use per-editor env injection to avoid prop drilling.
- Define an intent-only event bus contract; actions own state + history.
- Centralize persistence in a service; keep UI stateless.
