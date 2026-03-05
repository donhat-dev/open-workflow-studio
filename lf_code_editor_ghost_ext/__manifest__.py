{
    "name": "LF Code Editor Ghost Extension",
    "version": "18.0.1.0.0",
    "category": "Technical",
    "summary": "Targeted ghost suggestion extension for code widget",
    "author": "LF Group Tech",
    "maintainer": "LF Group Tech",
    "license": "LGPL-3",
    "depends": ["base", "web"],
    "data": [
        "views/ir_actions_server_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "lf_code_editor_ghost_ext/static/src/js/lf_code_ghost_field.js",
            "lf_code_editor_ghost_ext/static/src/xml/lf_code_ghost_field.xml",
            "lf_code_editor_ghost_ext/static/src/scss/lf_code_ghost_field.scss",
        ],
    },
    "installable": True,
    "application": False,
}
