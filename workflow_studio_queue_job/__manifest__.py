{
    "name": "Workflow Studio Queue Job",
    "version": "18.0.1.0.0",
    "summary": "Optional queue_job integration for automated Workflow Studio triggers.",
    "author": "donhat-dev",
    "website": "https://github.com/donhat-dev/workflow_automation_builder",
    "category": "Productivity",
    "license": "LGPL-3",
    "depends": ["workflow_studio", "queue_job"],
    "data": [
        "views/ir_workflow_views.xml",
        "views/workflow_run_views.xml",
    ],
    "installable": True,
    "auto_install": False,
}
