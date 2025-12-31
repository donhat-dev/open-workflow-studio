# -*- coding: utf-8 -*-
{
    'name': 'Workflow Pilot',
    'version': '1.0.0',
    'summary': """ Workflow_pilot Summary """,
    'author': '',
    'website': '',
    'category': '',
    'depends': ['base', 'web'],
    'data': [
        'data/workflow_pilot_menu.xml',
    ],
    'assets': {
        # Core libs bundle - can be lazy-loaded or included separately
        'workflow_pilot.assets_libs': [
            'workflow_pilot/static/lib/dagre.js/dagre.min.js',
            'workflow_pilot/static/lib/motion/**/*',
        ],
        'web.assets_backend': [
            # Include libs bundle first
            ('include', 'workflow_pilot.assets_libs'),
            # Registries (define categories and lib refs)
            'workflow_pilot/static/src/registries/**/*',
            # Mocks / Frontend execution engine (used by services)
            'workflow_pilot/static/src/mocks/**/*',
            # Services (depend on registries)
            'workflow_pilot/static/src/services/**/*',
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
