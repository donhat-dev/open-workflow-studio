"""
Workflow Snapshot Blob Model

Stores compressed, deduplicated workflow snapshots by hash.
Uses zlib compression + base64 to minimize size and keep deterministic restore.
"""

import hashlib
import json

from odoo import api, fields, models, tools
from odoo.tools import misc


class WorkflowSnapshotBlob(models.Model):
    _name = "ir.workflow.snapshot.blob"
    _description = "Workflow Snapshot Blob"
    _order = "create_date desc"

    name = fields.Char(string="Name")
    blob_hash = fields.Char(string="Blob Hash", required=True, index=True)
    compression = fields.Selection(
        [
            ("zlib", "Zlib"),
        ],
        string="Compression",
        default="zlib",
        required=True,
    )
    data = fields.Binary(string="Compressed Data", required=True, attachment=True)
    raw_size = fields.Integer(string="Raw Size")
    compressed_size = fields.Integer(string="Compressed Size")

    _sql_constraints = [
        (
            "workflow_snapshot_blob_hash_uniq",
            "UNIQUE(blob_hash)",
            "Snapshot blob hash must be unique.",
        ),
    ]

    @api.model
    def _canonical_json(self, snapshot):
        return json.dumps(
            snapshot or {},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    @api.model
    def _compute_blob_hash(self, payload):
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @api.model
    def _compress_payload(self, payload):
        raw_bytes = payload.encode("utf-8")
        compressed = misc.zlib.compress(raw_bytes, 9)
        return raw_bytes, compressed

    @api.model
    def _encode_binary(self, data):
        return misc.base64.b64encode(data)

    @api.model
    def _decode_binary(self, data):
        if not data:
            return b""
        return misc.base64.b64decode(data)

    @api.model
    def get_or_create_from_snapshot(self, snapshot):
        payload = self._canonical_json(snapshot)
        blob_hash = self._compute_blob_hash(payload)

        existing = self.search([("blob_hash", "=", blob_hash)], limit=1)
        if existing:
            return existing, blob_hash

        raw_bytes, compressed = self._compress_payload(payload)
        record = self.create(
            {
                "name": f"Snapshot {blob_hash[:8]}",
                "blob_hash": blob_hash,
                "compression": "zlib",
                "data": self._encode_binary(compressed),
                "raw_size": len(raw_bytes),
                "compressed_size": len(compressed),
            }
        )
        return record, blob_hash

    @api.model
    @tools.ormcache("blob_hash")
    def _get_snapshot_payload(self, blob_hash):
        blob = self.search([("blob_hash", "=", blob_hash)], limit=1)
        if not blob:
            return None

        compressed = self._decode_binary(blob.data)
        if not compressed:
            return None

        raw_bytes = misc.zlib.decompress(compressed)
        return raw_bytes.decode("utf-8")

    @api.model
    def get_snapshot(self, blob_hash):
        payload = self._get_snapshot_payload(blob_hash)
        if not payload:
            return None
        return json.loads(payload)
