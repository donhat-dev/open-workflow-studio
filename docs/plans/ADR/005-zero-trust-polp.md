# ADR-005: Zero Trust + PoLP for Workflow Execution and Data Access

---

## Status

**Accepted**

---

## Context

Workflow execution can access sensitive data (e.g., credentials, configuration parameters, customer data) through node execution. Today, outputs and logs are returned to the UI with minimal separation of duties, which risks accidental or unauthorized exposure. We need a security model that assumes untrusted access, minimizes privileges, and applies consistent masking and authorization checks across execution, outputs, and logs.

---

## Decision

Adopt a **Zero Trust + Principle of Least Privilege (PoLP)** security model for workflow execution and observability. This includes:

1. **Resource-based access control (RLS) over role-only checks**
   - Enforce record-level rules on workflow, run, output, and log records.
   - Default to deny access unless explicitly allowed by policy.

2. **Impersonation-based execution (Run-as User)**
   - Replace sudo-style execution with explicit impersonation.
   - Configure a "Run as user" for each workflow (similar to `ir.actions.server` / scheduled actions).
   - Enforce access checks as the effective user at execution time.

3. **Explicit read model (mask by default)**
   - All outputs/logs are masked by default.
   - Unmask only when `user.has_group(...)` or custom expression explicitly allows it.
   - No "admin exception" without explicit allowlist policy.

4. **Secure logging: runtime vs. display logs**
   - Inherit `ir.logging` model with workflow-specific fields.
   - Maintain **message** (raw, privileged) and **message_display** (masked, user-safe).
   - Permissions differ for: runner, creator, editor, and viewer.

5. **Context allowlisting and capability gating**
   - Use `odoo.tools.facade.Proxy` pattern for SafeEnvProxy (whitelist-based).
   - Execution context only exposes safe namespaces by default.
   - Sensitive capabilities (e.g., sudo, with_user) are blocked.

6. **Secret access through brokered APIs**
   - Secrets are accessed via a broker (`secret.get(key)`), never through raw ORM calls.
   - Initial backend: `ir.config_parameter` with prefix `workflow_pilot.secret.`
   - Extensible to KMS/Vault in future.

---

## Confirmed Decisions

| # | Decision | Value | Source |
|---|----------|-------|--------|
| 1 | **group_id priority** | Instance override (node instance > node type) | User confirmation |
| 2 | **run_as_user** | Workflow level, default = current user | User confirmation |
| 3 | **Env proxy** | Allowlist/denylist per workflow, always block `ir.*` | User confirmation |
| 4 | **Redaction** | Mask all by default, unmask via `group_id` + expression | User confirmation |
| 5 | **Unmask expression context** | `env, user, uid, company, workflow, node, run` — `safe_eval mode='eval'` | User confirmation |
| 6 | **SafeModelProxy** | Block `sudo` + `with_user`, `__getattribute__` + pre/post hooks on **all methods** | User confirmation |
| 7 | **Secret context** | `secret.get(key)` via `ir.config_parameter`, extensible to KMS/Vault | User confirmation |
| 8 | **Secret prefix** | `workflow_pilot.secret.` | User confirmation |
| 9 | **Audit log** | Inherit `ir.logging`, add workflow fields + `message_display` | User confirmation |
| 10 | **Log retention** | 30 days, auto-cleanup via `@api.autovacuum` | User confirmation |

---

## Technical Design

### Data Model

#### 1. Workflow Security Fields (`ir.workflow` or equivalent)

```python
class IrWorkflow(models.Model):
    _inherit = 'ir.workflow'  # or actual model name
    
    # Run-as user (default = current user at runtime)
    run_as_user_id = fields.Many2one(
        'res.users',
        string='Run as User',
        help='User context for workflow execution. Leave empty to use current user.'
    )
    
    # Model access control
    model_allowlist = fields.Text(
        string='Model Allowlist (JSON)',
        help='JSON array of model names allowed. Empty = all allowed (except denylist)'
    )
    model_denylist = fields.Text(
        string='Model Denylist (JSON)',
        default='["ir.%"]',
        help='JSON array of model patterns to block. Supports % wildcard. ir.* always blocked.'
    )
```

#### 2. Node Security Fields (`workflow.type`, `workflow.node`)

```python
class WorkflowType(models.Model):
    _inherit = 'workflow.type'
    
    group_id = fields.Many2one(
        'res.groups',
        string='Required Group',
        help='Group required to add/configure this node type'
    )

class WorkflowNode(models.Model):
    _inherit = 'workflow.node'
    
    # Override group (takes priority over node type)
    group_id = fields.Many2one(
        'res.groups',
        string='Required Group (Override)',
        help='Overrides the node type group_id'
    )
    
    # Unmask expression
    unmask_expression = fields.Char(
        string='Unmask Expression',
        help="Python expression returning True to unmask output. "
             "Context: env, user, uid, company, workflow, node, run"
    )
```

#### 3. Workflow Audit Log (inherit `ir.logging`)

```python
class IrLoggingWorkflow(models.Model):
    _inherit = 'ir.logging'
    
    # Workflow context
    workflow_run_id = fields.Many2one(
        'workflow.run',
        string='Workflow Run',
        index=True,
        ondelete='cascade'
    )
    workflow_node_id = fields.Many2one(
        'workflow.node',
        string='Workflow Node',
        index=True,
        ondelete='set null'
    )
    
    # Event categorization
    event_type = fields.Selection([
        ('node_start', 'Node Started'),
        ('node_end', 'Node Ended'),
        ('node_error', 'Node Error'),
        ('model_access', 'Model Accessed'),
        ('secret_access', 'Secret Accessed'),
        ('expression_eval', 'Expression Evaluated'),
        ('output_read', 'Output Read'),
        ('output_unmask', 'Output Unmasked'),
    ], string='Event Type', index=True)
    
    # Timing
    duration_ms = fields.Integer(string='Duration (ms)')
    
    # Masked message for display
    message_display = fields.Text(
        string='Masked Message',
        help='Masked version of message for non-privileged users'
    )
    
    # Model access tracking
    model_name = fields.Char(string='Model', index=True)
    method_name = fields.Char(string='Method')
    
    # Secret access tracking
    secret_key = fields.Char(string='Secret Key (masked)')
    
    # Success/failure
    success = fields.Boolean(string='Success', default=True)
    
    @api.autovacuum
    def _gc_workflow_logs(self):
        """Auto-cleanup workflow logs older than 30 days."""
        limit_date = fields.Datetime.now() - timedelta(days=30)
        self.env.cr.execute("""
            DELETE FROM ir_logging
            WHERE create_date < %s
            AND workflow_run_id IS NOT NULL
        """, (limit_date,))
        return True
```

#### 4. Node Output Model

```python
class WorkflowNodeOutput(models.Model):
    _name = 'workflow.node.output'
    _description = 'Workflow Node Output'
    
    run_id = fields.Many2one('workflow.run', required=True, ondelete='cascade')
    node_id = fields.Many2one('workflow.node', required=True, ondelete='cascade')
    
    # Dual outputs
    output_raw = fields.Text(
        string='Raw Output',
        groups='base.group_system',
        help='Unmasked output (may contain secrets)'
    )
    output_display = fields.Text(
        string='Display Output',
        help='Masked output for general viewing'
    )
    
    # JSON for programmatic access
    output_json = fields.Text(string='Output JSON')
```

---

### SafeEnvProxy (using `odoo.tools.facade.Proxy`)

**File:** `workflow_pilot/models/security/safe_env_proxy.py`

**Rationale:** `odoo.tools.facade.Proxy` is a whitelist-based proxy pattern that only exposes explicitly declared attributes/methods. This is ideal for SafeEnvProxy where we want to:
- Block `sudo()`, `with_user()`, `with_context()` (by not declaring them)
- Expose only safe attributes: `user`, `uid`, `company`, `context`, `ref()`
- Override `__getitem__` for model access control

```python
"""
SafeEnvProxy using odoo.tools.facade.Proxy pattern.

The Facade pattern is whitelist-based: only explicitly declared
attributes/methods are accessible. Undeclared = AttributeError.

This is perfect for blocking sudo/with_user/with_context while
exposing safe attributes.
"""
import json
from odoo.exceptions import AccessError
from odoo.tools.facade import Proxy, ProxyAttr, ProxyFunc


class SafeEnvProxy(Proxy):
    """
    Secure Environment proxy that:
    - Blocks sudo(), with_user(), with_context() (not declared = blocked)
    - Enforces model allowlist/denylist
    - Always blocks ir.* models
    - Returns SafeModelProxy for model access
    """
    from odoo.api import Environment
    _wrapped__ = Environment
    
    # === Safe attributes (whitelist) ===
    user = ProxyAttr()
    uid = ProxyAttr()
    company = ProxyAttr()
    companies = ProxyAttr()
    context = ProxyAttr()
    lang = ProxyAttr()
    
    # === Safe methods (whitelist) ===
    ref = ProxyFunc()
    is_superuser = ProxyFunc()
    is_admin = ProxyFunc()
    
    # === NOT declared (blocked) ===
    # sudo, with_user, with_context → AttributeError
    
    def __init__(self, env, allowlist=None, denylist=None, hooks=None):
        """
        Initialize SafeEnvProxy.
        
        Args:
            env: Original odoo.api.Environment
            allowlist: List of allowed model names (empty = all except denylist)
            denylist: List of denied model patterns (supports % wildcard)
            hooks: Dict with 'pre' and 'post' hook lists for model access
        """
        super().__init__(env)
        object.__setattr__(self, '_allowlist', allowlist or [])
        object.__setattr__(self, '_denylist', denylist or ['ir.%'])
        object.__setattr__(self, '_hooks', hooks or {'pre': [], 'post': []})
    
    def __getitem__(self, model_name):
        """
        Override model access to enforce allowlist/denylist.
        Returns SafeModelProxy instead of raw model.
        """
        if not self._is_model_allowed(model_name):
            raise AccessError(
                f"Model '{model_name}' is not allowed in this workflow context. "
                f"Blocked by denylist pattern or not in allowlist."
            )
        
        from .safe_model_proxy import SafeModelProxy
        return SafeModelProxy(
            self._wrapped__[model_name],
            env_proxy=self,
            pre_hooks=self._hooks.get('pre', []),
            post_hooks=self._hooks.get('post', [])
        )
    
    def _is_model_allowed(self, model_name):
        """Check if model is allowed based on allowlist/denylist."""
        # Always block ir.* (security critical)
        if model_name.startswith('ir.'):
            return False
        
        # Check denylist patterns
        for pattern in self._denylist:
            if self._match_pattern(model_name, pattern):
                return False
        
        # Check allowlist (if set, must be in list)
        if self._allowlist:
            return any(
                self._match_pattern(model_name, p) 
                for p in self._allowlist
            )
        
        return True
    
    @staticmethod
    def _match_pattern(name, pattern):
        """Match model name against pattern with % wildcard."""
        if '%' not in pattern:
            return name == pattern
        
        # Convert % wildcard to regex-like matching
        if pattern.endswith('%'):
            prefix = pattern[:-1]
            return name.startswith(prefix)
        
        # Simple prefix/suffix matching
        parts = pattern.split('%')
        if len(parts) == 2:
            return name.startswith(parts[0]) and name.endswith(parts[1])
        
        return name == pattern
    
    @classmethod
    def from_workflow(cls, env, workflow):
        """
        Factory method to create SafeEnvProxy from workflow record.
        
        Args:
            env: Original environment
            workflow: workflow.run or ir.workflow record with security settings
        """
        allowlist = json.loads(workflow.model_allowlist or '[]')
        denylist = json.loads(workflow.model_denylist or '["ir.%"]')
        
        # Ensure ir.* is always in denylist
        if 'ir.%' not in denylist:
            denylist.append('ir.%')
        
        return cls(env, allowlist=allowlist, denylist=denylist)
```

---

### SafeModelProxy (custom implementation with hooks)

**File:** `workflow_pilot/models/security/safe_model_proxy.py`

**Rationale:** Unlike SafeEnvProxy, SafeModelProxy needs to delegate **all** ORM methods (search, read, write, filtered, mapped, etc.) while adding pre/post hooks. The `odoo.tools.facade.Proxy` pattern is whitelist-based and would require declaring hundreds of methods. A custom `__getattr__` implementation is more practical.

```python
"""
SafeModelProxy with pre/post hooks on all method calls.

This proxy:
- Blocks sudo() and with_user() (always)
- Delegates all other methods to wrapped model
- Calls pre_hook before each method
- Calls post_hook after each method
- Wraps returned recordsets in new proxy
"""
import functools
from odoo import models
from odoo.exceptions import AccessError


class SafeModelProxy:
    """
    Model proxy with method interception hooks.
    
    Unlike SafeEnvProxy which uses whitelist (Facade pattern),
    this uses blacklist + delegation since ORM has many methods.
    """
    
    BLOCKED_METHODS = frozenset({'sudo', 'with_user'})
    
    def __init__(self, model, env_proxy, pre_hooks=None, post_hooks=None):
        """
        Initialize SafeModelProxy.
        
        Args:
            model: Odoo model/recordset to wrap
            env_proxy: Parent SafeEnvProxy instance
            pre_hooks: List of callables(model_name, method_name, args, kwargs)
            post_hooks: List of callables(model_name, method_name, args, kwargs, result)
        """
        object.__setattr__(self, '_model', model)
        object.__setattr__(self, '_env_proxy', env_proxy)
        object.__setattr__(self, '_pre_hooks', pre_hooks or [])
        object.__setattr__(self, '_post_hooks', post_hooks or [])
    
    def __getattr__(self, name):
        """
        Intercept attribute access:
        - Block dangerous methods
        - Wrap callable attributes with hooks
        - Return non-callable attributes directly
        """
        # Block dangerous methods
        if name in self.BLOCKED_METHODS:
            raise AccessError(
                f"{name}() is not allowed in workflow execution. "
                f"Use the configured run_as_user instead."
            )
        
        attr = getattr(self._model, name)
        
        # Wrap callables with hooks
        if callable(attr):
            return self._wrap_with_hooks(name, attr)
        
        return attr
    
    def __setattr__(self, name, value):
        """Delegate attribute setting to wrapped model."""
        if name.startswith('_'):
            object.__setattr__(self, name, value)
        else:
            setattr(self._model, name, value)
    
    def __iter__(self):
        """Iterate over wrapped recordset."""
        for record in self._model:
            yield SafeModelProxy(
                record,
                self._env_proxy,
                self._pre_hooks,
                self._post_hooks
            )
    
    def __len__(self):
        return len(self._model)
    
    def __bool__(self):
        return bool(self._model)
    
    def __repr__(self):
        return f"<SafeModelProxy({self._model!r})>"
    
    def _wrap_with_hooks(self, method_name, method):
        """
        Wrap method with pre/post hooks.
        
        Pre-hooks are called before method execution.
        Post-hooks are called after, with result.
        
        If result is a recordset, wrap it in new proxy.
        """
        @functools.wraps(method)
        def wrapper(*args, **kwargs):
            model_name = self._model._name
            
            # Call pre-hooks
            for hook in self._pre_hooks:
                try:
                    hook(model_name, method_name, args, kwargs)
                except Exception:
                    pass  # Don't let hook errors break execution
            
            # Execute actual method
            result = method(*args, **kwargs)
            
            # Call post-hooks
            for hook in self._post_hooks:
                try:
                    hook(model_name, method_name, args, kwargs, result)
                except Exception:
                    pass
            
            # Wrap recordset results in new proxy
            if isinstance(result, models.BaseModel):
                return SafeModelProxy(
                    result,
                    self._env_proxy,
                    self._pre_hooks,
                    self._post_hooks
                )
            
            return result
        
        return wrapper
    
    # === Delegate common ORM properties ===
    
    @property
    def ids(self):
        return self._model.ids
    
    @property
    def id(self):
        return self._model.id
    
    @property
    def _name(self):
        return self._model._name
    
    @property
    def env(self):
        """Return SafeEnvProxy instead of raw env."""
        return self._env_proxy
```

---

### SecretBroker

**File:** `workflow_pilot/models/security/secret_broker.py`

```python
"""
SecretBroker - Brokered access to secrets.

Current backend: ir.config_parameter
Future: KMS, HashiCorp Vault, AWS Secrets Manager
"""


class SecretBroker:
    """
    Provides secure access to secrets.
    
    In runtime mode: returns actual secret values
    In display mode: returns masked values
    
    Usage in code node:
        api_key = secret.get('openai_api_key')
    """
    
    MASK_VALUE = '********'
    PREFIX = 'workflow_pilot.secret.'
    
    def __init__(self, env, mask_mode=False):
        """
        Initialize SecretBroker.
        
        Args:
            env: Odoo environment (for ir.config_parameter access)
            mask_mode: If True, return masked values instead of actual secrets
        """
        self._env = env
        self._mask_mode = mask_mode
        self._backends = [
            ConfigParameterBackend(env, self.PREFIX),
            # Future: add more backends
            # KMSBackend(env),
            # VaultBackend(env),
        ]
    
    def get(self, key, default=None):
        """
        Get secret value by key.
        
        Args:
            key: Secret key (without prefix)
            default: Default value if not found
            
        Returns:
            Actual value (runtime mode) or masked value (display mode)
        """
        for backend in self._backends:
            if backend.has_key(key):
                if self._mask_mode:
                    return self.MASK_VALUE
                return backend.get(key)
        return default
    
    def has(self, key):
        """Check if secret exists."""
        return any(backend.has_key(key) for backend in self._backends)
    
    def list_keys(self):
        """
        List available secret keys (for autocomplete).
        Returns masked key list (keys only, no values).
        """
        keys = []
        for backend in self._backends:
            keys.extend(backend.list_keys())
        return sorted(set(keys))


class ConfigParameterBackend:
    """
    Secret backend using ir.config_parameter.
    
    Keys are stored with prefix: workflow_pilot.secret.<key>
    """
    
    def __init__(self, env, prefix):
        self._env = env
        self._prefix = prefix
    
    def _full_key(self, key):
        return self._prefix + key
    
    def has_key(self, key):
        param = self._env['ir.config_parameter'].sudo().get_param(
            self._full_key(key), default=None
        )
        return param is not None
    
    def get(self, key):
        return self._env['ir.config_parameter'].sudo().get_param(
            self._full_key(key)
        )
    
    def list_keys(self):
        """List all keys with our prefix."""
        params = self._env['ir.config_parameter'].sudo().search([
            ('key', 'like', self._prefix + '%')
        ])
        return [
            p.key.replace(self._prefix, '')
            for p in params
        ]
```

---

### Unmask Expression Evaluation

**File:** `workflow_pilot/models/workflow_node.py` (addition)

```python
def _should_unmask_for_user(self, user, run=None):
    """
    Check if output should be unmasked for this user.
    
    Priority:
    1. node.group_id (instance override)
    2. node_type.group_id
    3. unmask_expression (evaluated with safe_eval)
    
    Returns:
        bool: True if user can view unmasked output
    """
    # Check group_id (node instance first, then node type)
    effective_group = self.group_id or self.type_id.group_id
    if effective_group:
        xml_id = effective_group.get_external_id().get(effective_group.id, '')
        if xml_id and not user.has_group(xml_id):
            return False
        elif not xml_id:
            # No external ID, check direct membership
            if effective_group not in user.groups_id:
                return False
    
    # Check unmask_expression if set
    if self.unmask_expression:
        return self._eval_unmask_expression(user, run)
    
    # Default: masked (Zero Trust)
    return False

def _eval_unmask_expression(self, user, run=None):
    """
    Evaluate unmask expression with safe_eval mode='eval'.
    
    Context available:
    - env, user, uid, company, company_id, company_ids
    - workflow, node, run
    - True, False
    
    Returns:
        bool: Expression result (False on error)
    """
    from odoo.tools.safe_eval import safe_eval
    
    context = {
        # Environment context
        'env': self.env,
        'user': user,
        'uid': user.id,
        'company': user.company_id,
        'company_id': user.company_id.id,
        'company_ids': user.company_ids.ids,
        
        # Workflow context
        'workflow': self.workflow_id,
        'node': self,
        'run': run or self.env.context.get('active_run'),
        
        # Builtins
        'True': True,
        'False': False,
    }
    
    try:
        result = safe_eval(self.unmask_expression, context, mode='eval')
        return bool(result)
    except Exception:
        # On error, default to masked (fail-safe)
        return False
```

---

### Executor Integration

**File:** `workflow_pilot/models/workflow_executor.py` (additions)

```python
def _get_secure_eval_context(self, node, input_data):
    """
    Build secure evaluation context for node execution.
    
    Returns context dict with:
    - Standard namespaces (_json, _vars, _node, etc.)
    - SafeEnvProxy (instead of raw env)
    - SecretBroker (for secret.get())
    """
    from .security.safe_env_proxy import SafeEnvProxy
    from .security.secret_broker import SecretBroker
    
    workflow = self.workflow_id
    
    # Determine effective user
    run_as_user = workflow.run_as_user_id or self.env.user
    effective_env = self.env(user=run_as_user)
    
    # Create audit hook
    def audit_model_access(model_name, method_name, args, kwargs):
        self.env['ir.logging'].create({
            'name': 'workflow_pilot.model_access',
            'type': 'server',
            'dbname': self.env.cr.dbname,
            'level': 'INFO',
            'message': f"Accessed {model_name}.{method_name}",
            'path': __file__,
            'func': '_get_secure_eval_context',
            'line': '0',
            'workflow_run_id': self.run_id.id,
            'workflow_node_id': node.id,
            'event_type': 'model_access',
            'model_name': model_name,
            'method_name': method_name,
            'message_display': f"Accessed {model_name}.{method_name}",
            'success': True,
        })
    
    # Create safe environment proxy
    safe_env = SafeEnvProxy.from_workflow(effective_env, workflow)
    safe_env._hooks['pre'].append(audit_model_access)
    
    # Create secret broker (runtime mode = unmasked)
    secret = SecretBroker(self.env, mask_mode=False)
    
    return {
        # Standard namespaces
        '_json': input_data,
        '_input': input_data,
        '_vars': self._get_variables(),
        '_node': self._get_node_outputs(),
        '_loop': self._get_loop_context(),
        
        # Time
        '_now': datetime.now(),
        '_today': date.today(),
        
        # Execution metadata
        '_execution': self._get_execution_context(),
        '_workflow': self._get_workflow_context(),
        
        # Secure proxies
        'env': safe_env,
        'secret': secret,
        
        # Output variable
        'result': None,
    }

def _redact_output(self, output, node):
    """
    Redact output for display.
    
    Returns:
        tuple: (output_raw, output_display)
    """
    import json
    
    output_raw = json.dumps(output) if not isinstance(output, str) else output
    
    # Check if current user can see unmasked
    if node._should_unmask_for_user(self.env.user, run=self.run_id):
        output_display = output_raw
    else:
        output_display = self._mask_sensitive_data(output_raw)
    
    return output_raw, output_display

def _mask_sensitive_data(self, text):
    """
    Mask sensitive patterns in text.
    
    Patterns masked:
    - API keys (sk-..., key-..., etc.)
    - Passwords
    - Tokens
    - Email addresses
    - Credit card numbers
    """
    import re
    
    patterns = [
        (r'(sk-[a-zA-Z0-9]{20,})', '********'),  # OpenAI-style keys
        (r'(key-[a-zA-Z0-9]{20,})', '********'),  # Generic API keys
        (r'(password["\s:=]+)[^\s,"]+', r'\1********'),  # Passwords
        (r'(token["\s:=]+)[^\s,"]+', r'\1********'),  # Tokens
        (r'(secret["\s:=]+)[^\s,"]+', r'\1********'),  # Secrets
        (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '***@***.***'),  # Emails
    ]
    
    result = text
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    
    return result
```

---

## File Structure

```
workflow_pilot/
├── models/
│   ├── security/                       # NEW directory
│   │   ├── __init__.py
│   │   ├── safe_env_proxy.py           # SafeEnvProxy (uses Facade pattern)
│   │   ├── safe_model_proxy.py         # SafeModelProxy (custom __getattr__)
│   │   └── secret_broker.py            # SecretBroker + backends
│   ├── ir_logging_workflow.py          # Inherit ir.logging
│   ├── workflow_node_output.py         # Node output storage
│   ├── workflow_node.py                # + unmask logic
│   └── workflow_executor.py            # + security integration
├── security/
│   └── ir.model.access.csv             # + new model ACLs
└── views/
    └── ir_logging_views.xml            # + workflow log views
```

---

## Access Control

```csv
# security/ir.model.access.csv (additions)
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_workflow_node_output_user,workflow.node.output user,model_workflow_node_output,base.group_user,1,0,0,0
access_workflow_node_output_admin,workflow.node.output admin,model_workflow_node_output,base.group_system,1,1,1,1
```

---

## Implementation Phases

| Phase | Scope | Priority | Estimate |
|-------|-------|----------|----------|
| **P1** | Data Model (security fields on ir.workflow, workflow.node) | High | 2h |
| **P2** | ir.logging inheritance + workflow fields | High | 2h |
| **P3** | SafeEnvProxy (Facade pattern) | High | 3h |
| **P4** | SafeModelProxy (hooks) | High | 3h |
| **P5** | SecretBroker | Medium | 2h |
| **P6** | Unmask logic (_should_unmask_for_user) | Medium | 2h |
| **P7** | Executor integration | Medium | 3h |
| **P8** | Auto-cleanup cron (@api.autovacuum) | Low | 1h |
| **P9** | UI (unmask config, view raw button) | Low | 4h |
| **P10** | Migration script | Low | 2h |

**Total estimate:** ~24h

---

## Sequence Diagram

```
┌─────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐
│   UI    │    │  Executor    │    │ SafeEnvProxy │    │SafeModelProxy│    │ ir.logging│
└────┬────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └─────┬─────┘
     │                │                   │                   │                  │
     │ execute()      │                   │                   │                  │
     │───────────────>│                   │                   │                  │
     │                │                   │                   │                  │
     │                │ _get_secure_eval_context()            │                  │
     │                │───────────────────>                   │                  │
     │                │                   │                   │                  │
     │                │   Create SafeEnvProxy                 │                  │
     │                │   with allowlist/denylist             │                  │
     │                │<───────────────────                   │                  │
     │                │                   │                   │                  │
     │                │ run node code     │                   │                  │
     │                │  ─ ─ ─ ─ ─ ─ ─ ─>│                   │                  │
     │                │                   │                   │                  │
     │                │   env['sale.order']                   │                  │
     │                │                   │──────────────────>│                  │
     │                │                   │ return SafeModelProxy               │
     │                │                   │<──────────────────│                  │
     │                │                   │                   │                  │
     │                │                   │   .search([...])  │                  │
     │                │                   │                   │──────────────────>
     │                │                   │                   │ pre_hook(audit)  │
     │                │                   │                   │<──────────────────
     │                │                   │                   │                  │
     │                │                   │   env.sudo()      │                  │
     │                │                   │──────────────────>│                  │
     │                │                   │ AccessError!      │                  │
     │                │                   │<──────────────────│                  │
     │                │                   │                   │                  │
     │                │ _redact_output()  │                   │                  │
     │                │───────────────────>                   │                  │
     │                │                   │                   │                  │
     │  {output_raw, output_display}      │                   │                  │
     │<───────────────│                   │                   │                  │
```

---

## Consequences

### Positive
- Stronger protection against accidental secret leakage
- Clearer separation of duties between editor/operator/auditor/admin
- Auditable, consistent access checks and masking rules
- Safer extensibility for custom nodes and code execution
- Uses existing Odoo patterns (`ir.logging`, `odoo.tools.facade`)

### Negative
- Higher implementation complexity (dual outputs/logs, proxy layers)
- Additional configuration required (run-as user, policies, masking rules)
- Slight performance overhead from proxy wrapping and audit hooks
- More engineering effort for full adoption across all nodes

### Neutral
- Hook errors are silently caught to prevent breaking execution

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance overhead from hooks | Medium | Hooks are lightweight; can disable per-workflow if needed |
| Breaking existing code nodes | High | Block `sudo` and `with_user`; all other ORM methods work normally | 
| Audit log table growth | Medium | 30-day retention + @api.autovacuum |
| `safe_eval` restrictions block code | Medium | Document allowed patterns; provide escape hatch for admins |
| Facade not exported in odoo.tools | Low | Import directly from `odoo.tools.facade` |

---

## References

- `odoo/tools/facade.py` - Proxy/Facade pattern implementation
- `odoo/addons/base/models/ir_logging.py` - Logging model
- `odoo/netsvc.py` - PostgreSQLHandler for log insertion
- `docs/plans/EXECUTION_ENGINE_ARCHITECTURE.md`
- ADR-001, ADR-002, ADR-004

---

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-02 |
| **Author** | OpenCode |
| **Status** | Accepted |
| **Reviewers** | TBD |
| **Related ADRs** | ADR-001, ADR-002, ADR-004 |
| **Related Tasks** | E4.Security.ZeroTrust |
