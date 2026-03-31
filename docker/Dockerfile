FROM python:3.12-bookworm

LABEL maintainer="workflow_automation_builder"

SHELL ["/bin/bash", "-xo", "pipefail", "-c"]

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DEBIAN_FRONTEND=noninteractive

# System dependencies for Odoo 18 on Debian Bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-liberation \
        fonts-noto-cjk \
        git \
        gnupg \
        libldap2-dev \
        libsasl2-dev \
        libssl-dev \
        libxml2-dev \
        libxslt1-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        liblcms2-dev \
        libffi-dev \
        libpq-dev \
        node-less \
        npm \
        xfonts-75dpi \
        xfonts-base \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# wkhtmltopdf 0.12.6.1 (Odoo 18 requirement)
RUN curl -sSL https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6.1-3/wkhtmltox_0.12.6.1-3.bookworm_amd64.deb -o /tmp/wkhtmltox.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/wkhtmltox.deb \
    && rm -f /tmp/wkhtmltox.deb \
    && rm -rf /var/lib/apt/lists/*

# Create odoo user and directories
RUN useradd -m -d /opt/odoo -s /bin/bash odoo \
    && mkdir -p /opt/odoo/source \
                /opt/odoo/custom \
                /opt/odoo/data \
                /etc/odoo \
    && chown -R odoo:odoo /opt/odoo /etc/odoo

# Install Odoo Python dependencies (Python 3.12 versions)
COPY requirements-docker.txt /tmp/requirements-docker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-docker.txt \
    && rm /tmp/requirements-docker.txt

# Install debugpy for remote debugging
RUN pip install --no-cache-dir debugpy

# Install project-specific dependencies
COPY requirements-project.txt /tmp/requirements-project.txt
RUN pip install --no-cache-dir -r /tmp/requirements-project.txt \
    && rm /tmp/requirements-project.txt

# Copy config and entrypoint
COPY odoo.conf /etc/odoo/odoo.conf
COPY entrypoint.sh /opt/odoo/entrypoint.sh
RUN sed -i 's/\r$//' /opt/odoo/entrypoint.sh \
    && chmod +x /opt/odoo/entrypoint.sh \
    && chown odoo:odoo /etc/odoo/odoo.conf

WORKDIR /opt/odoo/source
USER odoo

EXPOSE 8069 5678

ENTRYPOINT ["/opt/odoo/entrypoint.sh"]
