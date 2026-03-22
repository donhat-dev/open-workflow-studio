# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

{
    "name": "X2Many Search Widget",
    "summary": "Search view widget for x2many lines in form views",
    "category": "Hidden",
    "version": "1.0",
    "depends": ["web", "sale"],
    "data": [
        "views/sale_order_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "x2many_search_widget/static/src/core/*.js",
            "x2many_search_widget/static/src/patches/*.js",
            "x2many_search_widget/static/src/view_widgets/x2many_search_widget/*",
        ],
    },
    "license": "LGPL-3",
}
