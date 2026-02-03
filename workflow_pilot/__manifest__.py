# -*- coding: utf-8 -*-
{
    'name': 'Workflow Studio',
    'version': '1.0.0',
    'summary': """Visual workflow builder with node-based automation.
        Design complex workflows, execute with backpressure handling, and monitor execution results.""",
    'author': '',
    'website': '',
    'category': '',
    'depends': ['base', 'web', 'mail'],
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
        'workflow_pilot.assets_libs': [
            'workflow_pilot/static/lib/dagre.js/dagre.min.js',
            'workflow_pilot/static/lib/lucide/lucide.min.js',
            'workflow_pilot/static/lib/motion/**/*',
        ],
        'web.assets_backend': [
            # Include libs bundle first
            ('include', 'workflow_pilot.assets_libs'),
            # Registries (define categories and lib refs)
            'workflow_pilot/static/src/registries/**/*',
            # App entry points
            'workflow_pilot/static/src/app/**/*',
            # Store (workflowEditor service)
            'workflow_pilot/static/src/store/**/*',
            # Core classes (pure JS, minimal deps)
            'workflow_pilot/static/src/core/**/*',
            # Node definitions (register to node registry)
            'workflow_pilot/static/src/nodes/**/*',
            # Utilities
            'workflow_pilot/static/src/utils/**/*',
            # Components (use services)
            'workflow_pilot/static/src/components/**/*',
            # Entry points and styles
            'workflow_pilot/static/src/*.js',
            'workflow_pilot/static/src/*.css',
        ],
    },
    'application': True,
    'installable': True, 
    'auto_install': False,
    'license': 'LGPL-3',
}
