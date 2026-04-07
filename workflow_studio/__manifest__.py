{
    "name": "Workflow Studio",
    "version": "18.0.1.0.0",
    "summary": "Visual workflow builder with node-based automation.",
    "author": "donhat-dev",
    "website": "https://github.com/donhat-dev/workflow_automation_builder",
    "category": "Productivity",
    "license": "LGPL-3",
    "depends": ["base", "web", "mail", "bus"],
    "data": [
        "security/groups.xml",
        "security/ir.model.access.csv",
        "security/rules.xml",
        "data/data.xml",
        "data/workflow_type_data.xml",
        "views/ir_workflow_views.xml",
        "views/workflow_type_views.xml",
        "views/workflow_run_views.xml",
        "views/ir_logging_views.xml",
        "views/workflow_trigger_views.xml",
    ],
    "assets": {
        # Core libs bundle - can be lazy-loaded or included separately
        "workflow_studio.assets_libs": [
            "workflow_studio/static/lib/dagre/dagre.min.js",
            "workflow_studio/static/lib/lucide_font/lucide.css",
        ],
        "web.assets_backend": [
            # Include libs bundle first
            ("include", "workflow_studio.assets_libs"),
            # Registries (define categories and lib refs)
            "workflow_studio/static/src/registries/**/*",
            # App entry points
            "workflow_studio/static/src/app/**/*",
            # Store (workflowEditor service)
            "workflow_studio/static/src/store/**/*",
            # Services (bus integration, etc.)
            "workflow_studio/static/src/services/**/*",
            # Core classes (pure JS, minimal deps)
            "workflow_studio/static/src/core/**/*",
            # Utilities
            "workflow_studio/static/src/utils/**/*",
            # Shared SCSS layer (must load before component styles)
            "workflow_studio/static/src/scss/primary_variables.scss",
            "workflow_studio/static/src/scss/secondary_variables.scss",
            "workflow_studio/static/src/scss/bootstrap_overridden.scss",
            "workflow_studio/static/src/scss/_typography.scss",
            "workflow_studio/static/src/scss/shared_primitives.scss",
            # Components (use services)
            "workflow_studio/static/src/components/**/*",
            # View extensions (list/kanban dashboard overlays)
            "workflow_studio/static/src/views/**/*",
            # Entry points and styles
            "workflow_studio/static/src/*.js",
            "workflow_studio/static/src/*.css",
        ],
    },
    "application": True,
    "installable": True,
    "auto_install": False,
}
