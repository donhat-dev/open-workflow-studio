# -*- coding: utf-8 -*-
{
    'name': 'Workflow Studio Queue Job',
    'version': '1.0.0',
    'summary': 'Optional queue_job integration for automated Workflow Studio triggers.',
    'author': '',
    'website': '',
    'category': '',
    'depends': ['workflow_studio', 'queue_job'],
    'data': [
        'views/ir_workflow_views.xml',
        'views/workflow_run_views.xml',
    ],
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
