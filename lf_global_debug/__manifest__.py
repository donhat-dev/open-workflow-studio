# -*- coding: utf-8 -*-

{
    'name': 'LF Global WOWL Debug Helper',
    'version': '18.0.1.0.0',
    'category': 'Technical',
    'summary': 'Expose WOWL ORM service to browser globals for easier debugging',
    'author': 'LF Group Tech',
    'company': 'LF Group Tech',
    'maintainer': 'LF Group Tech',
    'depends': ['web'],
    'data': [],
    'assets': {
        'web.assets_backend': [
            'lf_global_debug/static/src/js/global_debug_expose.js',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': True,
}
