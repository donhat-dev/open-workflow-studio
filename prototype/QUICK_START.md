# 🚀 Quick Start - Code Node

## Cách chạy

### 1. Start HTTP Server
```bash
cd prototype
python -m http.server 8000
# hoặc
python3 -m http.server 8000
# hoặc (Windows)
python -m http.server 8000
```

### 2. Mở Browser
```
http://localhost:8000/index.html
```

### 3. Thêm Code Node
- Click vào **"Code"** node trong palette (sidebar trái)
- Node sẽ xuất hiện trên canvas

### 4. Viết Code
- **Click** vào Code node để select
- **Properties Panel** (bên phải) sẽ hiện Monaco Editor
- **Viết code** trong editor

### 5. Example Code
```javascript
// Input data: biến 'data'
// Return: giá trị output

return {
  message: "Hello from Code Node!",
  timestamp: new Date().toISOString(),
  inputData: data
};
```

## Test Demo

### Option 1: Full Workflow (index.html)
1. Mở `http://localhost:8000/index.html`
2. Add nodes: HTTP → Code → Mapping
3. Connect nodes
4. Configure Code node
5. Click **"▶ Run"**

### Option 2: Code Node Tests (code-node-test.html)
1. Mở `http://localhost:8000/code-node-test.html`
2. Click **"Run Test"** buttons
3. Xem kết quả

## Debug Console

Mở DevTools Console:
```javascript
// Access editor
window.app.editor

// Get all nodes
Array.from(window.app.editor.nodes.values())

// Add Code node programmatically
window.app.editor.addNode(
  window.WorkflowNodes.CodeNode, 
  { x: 300, y: 300 }
)

// Test code execution
const codeNode = Array.from(window.app.editor.nodes.values())[0];
await codeNode.data({ data: [{ test: 'hello' }] });
```

## Workflow Example

### 1. HTTP Request → Code → Data Mapping

**HTTP Node**: GET https://jsonplaceholder.typicode.com/users/1

**Code Node**:
```javascript
// Transform API response
return {
  userId: data.id,
  userName: data.name.toUpperCase(),
  email: data.email.toLowerCase(),
  company: data.company.name
};
```

**Data Mapping Node**: Map fields to target structure

### 2. Validation → Code → HTTP

**Validation Node**: Validate input data

**Code Node**:
```javascript
// Prepare API request body
return {
  order: {
    customer_id: data.userId,
    items: data.items.map(item => ({
      sku: item.productCode,
      qty: parseInt(item.quantity),
      price: parseFloat(item.unitPrice)
    })),
    total: data.items.reduce((sum, i) => 
      sum + (i.quantity * i.unitPrice), 0)
  }
};
```

**HTTP Node**: POST to API endpoint

## Common Code Patterns

### 1. Transform Array
```javascript
if (!Array.isArray(data)) {
  throw new Error('Input must be array');
}

return data.map(item => ({
  id: item.id,
  name: item.name.toUpperCase()
}));
```

### 2. Filter Data
```javascript
return {
  active: data.filter(item => item.status === 'active'),
  inactive: data.filter(item => item.status !== 'active'),
  total: data.length
};
```

### 3. Async API Call
```javascript
const response = await fetch('https://api.example.com/data');
const result = await response.json();

return {
  success: response.ok,
  data: result
};
```

### 4. Error Handling
```javascript
if (!data.requiredField) {
  throw new Error('Missing required field');
}

return { processed: data };
```

## Troubleshooting

### Monaco Editor không hiển thị
- **Check Console**: Xem có error loading Monaco CDN không
- **Try refresh**: Hard refresh (Ctrl+Shift+R)
- **Check network**: Đảm bảo internet connection OK

### Code execution error
- **Check syntax**: JavaScript syntax phải đúng
- **Check input**: Log `data` để xem input structure
- **Use console**: Check browser console cho error details

### Node không connect được
- **Socket type**: Input (square) ↔ Output (circle)
- **Direction**: Chỉ connect từ Output → Input
- **Same type**: Data ↔ Data, Error ↔ Error

## Next Steps

1. ✅ Test basic code execution
2. ✅ Connect với HTTP/Validation/Mapping nodes
3. ✅ Build complete workflow
4. ✅ Test async operations
5. 📖 Đọc `CODE_NODE_README.md` để hiểu sâu hơn

---

**Happy Coding!** 💻✨
