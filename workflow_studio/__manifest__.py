# -*- coding: utf-8 -*-
{
    'name': 'Workflow Studio',
    'version': '1.0.0',
    'summary': """Visual workflow builder with node-based automation.
        Design complex workflows, execute with backpressure handling, and monitor execution results.""",
    'author': '',
    'website': '',
    'category': '',
    'depends': ['base', 'web', 'mail', 'bus'],
    'data': [
        'security/groups.xml',
        'security/ir.model.access.csv',
        'data/data.xml',
        'data/workflow_type_data.xml',
        'views/ir_workflow_views.xml',
        'views/workflow_type_views.xml',
        'views/workflow_run_views.xml',
        'views/ir_logging_views.xml',
    ],
    'assets': {
        # Core libs bundle - can be lazy-loaded or included separately
        'workflow_studio.assets_libs': [
            'workflow_studio/static/lib/dagre/dagre.min.js',
            'workflow_studio/static/lib/lucide/lucide.min.js'
        ],
        'web.assets_backend': [
            # Include libs bundle first
            ('include', 'workflow_studio.assets_libs'),
            # Registries (define categories and lib refs)
            'workflow_studio/static/src/registries/**/*',
            # App entry points
            'workflow_studio/static/src/app/**/*',
            # Store (workflowEditor service)
            'workflow_studio/static/src/store/**/*',
            # Services (bus integration, etc.)
            'workflow_studio/static/src/services/**/*',
            # Core classes (pure JS, minimal deps)
            'workflow_studio/static/src/core/**/*',
            # Utilities
            'workflow_studio/static/src/utils/**/*',
            # Components (use services)
            'workflow_studio/static/src/components/**/*',
            # Entry points and styles
            'workflow_studio/static/src/*.js',
            'workflow_studio/static/src/*.css',
        ],
    },
    'application': True,
    'installable': True, 
    'auto_install': False,
    'license': 'LGPL-3',
}
