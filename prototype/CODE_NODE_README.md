# Code Node Enhancement

## Tổng quan

Code Node đã được nâng cấp với **Monaco Editor** (editor chính thức của VS Code) và khả năng thực thi JavaScript code.

## Tính năng mới

### 1. Monaco Editor Integration
- **Editor**: Monaco Editor v0.45.0 (VS Code's editor)
- **Theme**: Dark theme với syntax highlighting
- **Features**:
  - Auto-completion
  - Syntax validation
  - Line numbers
  - Real-time error detection
  - Code formatting

### 2. JavaScript Code Execution
- Hỗ trợ async/await
- Access input data qua biến `data`
- Return kết quả hoặc Promise
- Error handling với stack trace

## Cách sử dụng

### Thêm Code Node
1. Mở **Node Palette** (sidebar trái)
2. Click vào **"Code"** node (icon 💻)
3. Node sẽ xuất hiện trên canvas

### Viết code
1. **Select** Code Node trên canvas
2. **Properties Panel** (bên phải) sẽ hiển thị Monaco Editor
3. Viết JavaScript code trong editor

### Cấu trúc code cơ bản

```javascript
// Input data từ node trước
// Biến 'data' chứa output của node được kết nối

// Ví dụ: Transform data
return {
  message: "Hello from Code Node!",
  processedData: data.someField?.toUpperCase(),
  timestamp: new Date().toISOString()
};
```

### Ví dụ nâng cao

#### 1. Filter & Transform Array
```javascript
// Giả sử input data là array of users
if (!Array.isArray(data)) {
  throw new Error('Input must be an array');
}

return {
  activeUsers: data.filter(user => user.active),
  count: data.length
};
```

#### 2. Async API Call
```javascript
// Fetch thêm data từ API
const response = await fetch('https://api.example.com/enrich', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});

const enriched = await response.json();
return enriched;
```

#### 3. Data Validation & Transform
```javascript
// Validate và transform
if (!data.orderId) {
  throw new Error('Missing orderId');
}

return {
  order: {
    id: data.orderId,
    total: parseFloat(data.amount),
    items: data.items?.map(item => ({
      sku: item.sku.toUpperCase(),
      qty: parseInt(item.quantity)
    }))
  }
};
```

## Inputs/Outputs

### Input Socket
- **Name**: `data`
- **Type**: DataSocket
- **Description**: Input data từ node trước

### Output Sockets
- **result**: Kết quả thực thi code (DataSocket)
- **error**: Error object nếu có lỗi (ErrorSocket)

## Error Handling

Code Node tự động catch errors và route qua `error` output socket:

```javascript
{
  message: "Error message here",
  stack: "Stack trace..."
}
```

Connect `error` socket để handle lỗi trong workflow.

## Technical Details

### Monaco Editor Configuration
```javascript
{
  language: 'javascript',
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  scrollBeyondLastLine: false,
  lineNumbers: 'on',
  tabSize: 2
}
```

### Code Execution Context
- Sử dụng `AsyncFunction` constructor
- Isolated execution context
- Input data passed as parameter
- Return value becomes output

### Security Notes
⚠️ **Warning**: Code execution trong browser environment - KHÔNG an toàn cho production!
- Chỉ dùng cho prototyping/testing
- Production cần server-side execution với sandboxing
- Không có access control hoặc resource limits

## Workflow Example

```
HTTP Request → Code Node → Data Mapping
```

**Code Node example**:
```javascript
// Parse HTTP response và extract data
const response = data; // từ HTTP Request node

if (!response.success) {
  throw new Error('API request failed');
}

return {
  orders: response.data.orders.map(o => ({
    id: o.order_id,
    customer: o.customer_name,
    total: parseFloat(o.total_amount)
  }))
};
```

## Roadmap

### Future Enhancements
- [ ] **TypeScript support**
- [ ] **Python execution** (via Pyodide)
- [ ] **NPM package imports**
- [ ] **Code templates/snippets**
- [ ] **Debugging tools** (breakpoints, step-through)
- [ ] **Unit testing integration**
- [ ] **Performance profiling**

### Production Requirements
- [ ] Server-side execution (Odoo backend)
- [ ] Sandboxed environment (VM2/isolated-vm)
- [ ] Resource limits (CPU, memory, timeout)
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Code review workflow

## CSS Classes

Code node sử dụng các CSS classes:
- `.node-palette__item--code` - Purple border (#8b5cf6)
- `.rete-node--code` - Purple header
- Monaco container - Custom styling trong properties panel

## Files Modified

1. **prototype/index.html** - Added Monaco Editor CDN
2. **prototype/nodes.js** - Added CodeNode class
3. **prototype/app.js** - Added Code node to palette + Monaco integration in PropertiesPanel
4. **prototype/styles.css** - Added Code node styling

## Testing

```javascript
// Mở browser console
window.app.editor.addNode(window.WorkflowNodes.CodeNode, { x: 300, y: 300 })

// Test execution
const codeNode = Array.from(window.app.editor.nodes.values())[0];
await codeNode.data({ data: [{ test: 'hello' }] });
```

---

**Tác giả**: Enhanced by GitHub Copilot  
**Version**: 1.0.0  
**Date**: 2026-01-05
