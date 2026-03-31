import sass
import os

D = chr(36)  # dollar sign

odoo_stubs = '\n'.join([
    f'{D}o-white: #ffffff !default;',
    f'{D}o-black: #000000 !default;',
    f'{D}o-gray-100: #f8f9fa !default;',
    f'{D}o-gray-200: #e9ecef !default;',
    f'{D}o-gray-300: #dee2e6 !default;',
    f'{D}o-gray-400: #ced4da !default;',
    f'{D}o-gray-500: #adb5bd !default;',
    f'{D}o-gray-600: #6c757d !default;',
    f'{D}o-gray-700: #495057 !default;',
    f'{D}o-gray-800: #343a40 !default;',
    f'{D}o-gray-900: #212529 !default;',
    f'{D}o-success: #28a745 !default;',
    f'{D}o-danger: #dc3545 !default;',
    f'{D}o-warning: #ffc107 !default;',
    f'{D}o-info: #17a2b8 !default;',
    f'{D}o-primary: #007bff !default;',
    f'{D}o-secondary: #6c757d !default;',
    f'{D}o-brand-primary: #714B67 !default;',
    f'{D}o-brand-odoo: #714B67 !default;',
    f'{D}o-action: #007bff !default;',
    f'{D}o-view-background-color: #ffffff !default;',
    f'{D}o-community-color: #714B67 !default;',
    f'{D}o-enterprise-color: #714B67 !default;',
    f'{D}o-webclient-background-color: #f0f0f0 !default;',
    f'{D}o-main-text-color: #212529 !default;',
])

base = 'workflow_studio/static/src/scss'
files_in_order = [
    'primary_variables.scss',
    'secondary_variables.scss',
    'bootstrap_overridden.scss',
    'shared_primitives.scss',
]

combined = odoo_stubs + '\n'
for f in files_in_order:
    fp = os.path.join(base, f)
    with open(fp, 'r', encoding='utf-8') as fh:
        combined += fh.read() + '\n'

try:
    result = sass.compile(string=combined)
    print('VARIABLE CHAIN: OK (compiles without errors)')
    print('Output length:', len(result), 'bytes')
except sass.CompileError as e:
    print('VARIABLE CHAIN ERROR:')
    print(str(e))

print()
print('=== Now testing each component SCSS file ===')
component_files = []
for root, dirs, files in os.walk('workflow_studio/static/src/components'):
    for fn in files:
        if fn.endswith('.scss'):
            component_files.append(os.path.join(root, fn))

errors = []
for cf in sorted(component_files):
    with open(cf, 'r', encoding='utf-8') as fh:
        full = combined + '\n' + fh.read()
    try:
        sass.compile(string=full)
        print(f'OK: {cf}')
    except sass.CompileError as e:
        err = str(e)
        print(f'ERROR: {cf}')
        print(f'  {err[:400]}')
        errors.append((cf, err))

print()
if errors:
    print(f'=== {len(errors)} component file(s) with SCSS errors ===')
    for cf, e in errors:
        print(f'\n--- {cf} ---')
        print(e[:600])
else:
    print('=== All component SCSS files compiled OK ===')
