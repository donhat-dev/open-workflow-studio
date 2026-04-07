import uuid

from odoo.tests import common, tagged

from odoo.addons.queue_job.tests.common import trap_jobs


@tagged("post_install", "-at_install")
class TestWorkflowQueueJobIntegration(common.TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Workflow = cls.env["ir.workflow"]
        cls.WorkflowRun = cls.env["workflow.run"]

    def _create_published_workflow(
        self, trigger_node_type="schedule_trigger", node_id="n_trigger"
    ):
        workflow_record = self.Workflow.create(
            {
                "name": "WF Queue %s" % uuid.uuid4().hex[:8],
            }
        )
        snapshot = {
            "nodes": [
                {
                    "id": node_id,
                    "type": trigger_node_type,
                    "label": "Trigger",
                    "config": {},
                },
                {
                    "id": "n_noop",
                    "type": "noop",
                    "label": "Noop",
                    "config": {},
                },
            ],
            "connections": [
                {
                    "id": "c_trigger_noop",
                    "source": node_id,
                    "sourceHandle": "output",
                    "target": "n_noop",
                    "targetHandle": "input",
                },
            ],
            "metadata": {},
        }
        workflow_record.write({"draft_snapshot": snapshot})
        workflow_record.action_publish()
        return workflow_record

    def test_automated_trigger_launch_enqueues_queue_job(self):
        workflow_record = self._create_published_workflow(
            trigger_node_type="schedule_trigger",
            node_id="n_schedule",
        )

        with trap_jobs() as trap:
            result = workflow_record._execute_from_trigger(
                "n_schedule",
                "schedule",
                {"from_test": True},
            )

            run = self.WorkflowRun.browse(result["run_id"])
            self.assertEqual(result["status"], "pending")
            self.assertEqual(run.status, "pending")
            self.assertEqual(run.execution_mode, "schedule")
            self.assertTrue(run.queue_job_uuid)
            self.assertFalse(run.queue_job_id)

            trap.assert_jobs_count(1)
            trap.assert_enqueued_job(run._queue_job_execute)

    def test_manual_launch_remains_synchronous(self):
        workflow_record = self._create_published_workflow(
            trigger_node_type="manual_trigger",
            node_id="n_manual",
        )

        with trap_jobs() as trap:
            result = workflow_record.execute_workflow(input_data={"hello": "world"})

            trap.assert_jobs_count(0)

        run = self.WorkflowRun.browse(result["run_id"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(run.status, "completed")
        self.assertFalse(run.queue_job_uuid)
        self.assertFalse(run.queue_job_id)

    def test_cancel_requested_cancels_pending_queue_job(self):
        workflow_record = self._create_published_workflow(
            trigger_node_type="schedule_trigger",
            node_id="n_schedule",
        )

        result = workflow_record._execute_from_trigger(
            "n_schedule",
            "schedule",
            {"from_test": True},
        )
        run = self.WorkflowRun.browse(result["run_id"])

        self.assertTrue(run.queue_job_id)
        self.assertEqual(run.queue_job_state, "pending")
        self.assertTrue(run.queue_can_cancel)

        run.action_cancel()
        run.invalidate_recordset(["status", "queue_job_state", "completed_at"])
        run.queue_job_id.invalidate_recordset(["state"])

        self.assertEqual(run.status, "cancelled")
        self.assertEqual(run.queue_job_id.state, "cancelled")
        self.assertEqual(run.queue_job_state, "cancelled")
        self.assertFalse(run.queue_can_cancel)
