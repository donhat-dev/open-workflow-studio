# -*- coding: utf-8 -*-
"""
SecretBroker - Secure Secret Access for Workflow Execution.

Provides brokered access to secrets via `secret.get(key)`.
Backend: ir.config_parameter with prefix 'workflow_pilot.secret.'
Extensible to KMS/Vault in future.
"""

import re


class SecretBroker:
    """
    Secure secret broker that:
    - Provides secret.get(key) interface
    - Masks secrets in display mode
    - Logs access for auditing
    """

    PREFIX = 'workflow_pilot.secret.'
    MASK_VALUE = '********'

    def __init__(self, env, mask_mode=True, audit_callback=None):
        """
        Initialize SecretBroker.

        Args:
            env: Odoo Environment
            mask_mode: If True, return masked values (for display)
            audit_callback: Optional callback(key, masked) for logging
        """
        self._env = env
        self._mask_mode = mask_mode
        self._audit_callback = audit_callback

    def get(self, key, default=None):
        """
        Get secret value by key.

        Args:
            key: Secret key (without prefix)
            default: Default value if not found

        Returns:
            Secret value (or masked if mask_mode=True)
        """
        if not self._validate_key(key):
            raise ValueError(f"Invalid secret key: {key}")

        full_key = f"{self.PREFIX}{key}"

        # Get from ir.config_parameter
        IrConfig = self._env['ir.config_parameter'].sudo()
        value = IrConfig.get_param(full_key, default=default)

        # Audit access
        if self._audit_callback:
            try:
                masked_key = self._mask_key(key)
                self._audit_callback(masked_key, self._mask_mode)
            except Exception:
                pass  # Silently ignore audit errors

        # Return masked or real value
        if self._mask_mode and value and value != default:
            return self.MASK_VALUE

        return value

    def exists(self, key):
        """
        Check if secret exists.

        Args:
            key: Secret key (without prefix)

        Returns:
            True if secret exists
        """
        if not self._validate_key(key):
            return False

        full_key = f"{self.PREFIX}{key}"
        IrConfig = self._env['ir.config_parameter'].sudo()
        value = IrConfig.get_param(full_key, default=None)
        return value is not None

    def _validate_key(self, key):
        """
        Validate secret key format.

        Allowed: alphanumeric, underscore, hyphen, dot
        """
        if not key or not isinstance(key, str):
            return False
        pattern = re.compile(r'^[a-zA-Z][a-zA-Z0-9_.\-]*$')
        return bool(pattern.match(key))

    def _mask_key(self, key):
        """
        Mask secret key for logging.

        Shows first 3 and last 2 chars if long enough.
        """
        if len(key) <= 6:
            return key[:2] + '***'
        return key[:3] + '***' + key[-2:]

    def __repr__(self):
        mode = 'masked' if self._mask_mode else 'unmasked'
        return f"SecretBroker(mode={mode})"


class SecretBrokerFactory:
    """
    Factory for creating SecretBroker instances with audit integration.
    """

    @staticmethod
    def for_execution(env, run_id=None, node_id=None, workflow_id=None):
        """
        Create SecretBroker for workflow execution (unmasked).

        Uses raw SQL with separate cursor to avoid transaction blocking.
        Pattern from odoo/addons/base/models/ir_actions.py

        Args:
            env: Odoo Environment
            run_id: Workflow run ID for audit
            node_id: Current node ID for audit
            workflow_id: Workflow ID for audit
        """
        def audit_callback(masked_key, is_masked):
            try:
                message_display = f"Secret accessed: {masked_key}"
                # Use separate cursor to avoid transaction issues
                with env.registry.cursor() as cr:
                    # Insert base ir_logging record first
                    cr.execute("""
                        INSERT INTO ir_logging (create_date, create_uid, type, dbname, name, level, message, path, line, func)
                        VALUES (NOW() at time zone 'UTC', %s, 'server', %s, 'workflow_pilot', 'INFO', %s, '', '0', 'SecretBroker.get')
                        RETURNING id
                    """, (env.uid, cr.dbname, message_display))
                    logging_id = cr.fetchone()[0]
                    
                    # Insert workflow-specific record
                    cr.execute("""
                        INSERT INTO ir_workflow_logging (
                            logging_id, workflow_run_id, workflow_node_id, workflow_id,
                            event_type, secret_key, message_display, success
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (logging_id, run_id, node_id, workflow_id, 'secret_access', masked_key, message_display, True))
            except Exception:
                pass  # Silently ignore logging errors

        return SecretBroker(env, mask_mode=False, audit_callback=audit_callback)

    @staticmethod
    def for_display(env):
        """
        Create SecretBroker for display purposes (masked).

        Args:
            env: Odoo Environment
        """
        return SecretBroker(env, mask_mode=True)
