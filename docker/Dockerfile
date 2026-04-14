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

# Install supervisor dependency
RUN pip install --no-cache-dir setproctitle

# Install project-specific dependencies
COPY requirements-project.txt /tmp/requirements-project.txt
RUN pip install --no-cache-dir -r /tmp/requirements-project.txt \
    && rm /tmp/requirements-project.txt

# Copy config
COPY odoo.conf /etc/odoo/odoo.conf
RUN chown odoo:odoo /etc/odoo/odoo.conf

# Copy supervisor (root-only, hidden from odoo user)
COPY supervisor.py /usr/local/sbin/odoo-supervisor
RUN sed -i 's/\r$//' /usr/local/sbin/odoo-supervisor \
    && chmod 700 /usr/local/sbin/odoo-supervisor \
    && chown root:root /usr/local/sbin/odoo-supervisor

# Copy odoo-rpc cron worker (readable by odoo user, spawned by supervisor)
COPY odoo-rpc /usr/local/sbin/odoo-rpc
RUN sed -i 's/\r$//' /usr/local/sbin/odoo-rpc \
    && chmod 755 /usr/local/sbin/odoo-rpc \
    && chown root:root /usr/local/sbin/odoo-rpc

# Copy odoo-bin wrapper (callable by odoo user from shell)
COPY odoo-bin /usr/local/bin/odoo-bin
RUN sed -i 's/\r$//' /usr/local/bin/odoo-bin \
    && chmod 755 /usr/local/bin/odoo-bin

# Copy supervisorctl CLI (callable by odoo user from shell)
COPY supervisorctl /usr/local/bin/supervisorctl
RUN sed -i 's/\r$//' /usr/local/bin/supervisorctl \
    && chmod 755 /usr/local/bin/supervisorctl

# Copy odoosh-restart CLI (callable by odoo user — sends PG NOTIFY to control plane)
COPY odoosh-restart /usr/local/bin/odoosh-restart
RUN sed -i 's/\r$//' /usr/local/bin/odoosh-restart \
    && chmod 755 /usr/local/bin/odoosh-restart

# Ensure /var/run exists for UDS control socket
RUN mkdir -p /var/run

# Keep entrypoint.sh as fallback (renamed)
COPY entrypoint.sh /opt/odoo/entrypoint-legacy.sh
RUN sed -i 's/\r$//' /opt/odoo/entrypoint-legacy.sh \
    && chmod +x /opt/odoo/entrypoint-legacy.sh

WORKDIR /opt/odoo/source

# PID 1 = supervisor (runs as root, drops privilege for workers)
USER root

EXPOSE 8069 5678

ENTRYPOINT ["python3", "/usr/local/sbin/odoo-supervisor"]
