FROM kasmweb/core-ubuntu-jammy:1.17.0@sha256:baa8c7c88353ab98ab9c918d6b44092576182ef407e6f07d3ae9c9c7df109f71

USER root
ENV DEBIAN_FRONTEND=noninteractive
ARG WINE_VERSION=11.21~jammy-1
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip python3-pip \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg \
    && echo 'deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/ubuntu/ jammy main' > /etc/apt/sources.list.d/winehq.list \
    && apt-get update
RUN apt-get install -y --install-recommends "winehq-devel=${WINE_VERSION}" \
    "wine-devel=${WINE_VERSION}" "wine-devel-amd64=${WINE_VERSION}" \
    "wine-devel-i386:i386=${WINE_VERSION}" \
    && apt-get clean

RUN mkdir -p /opt/mt5-dist/python /opt/mt5-bridge \
    && curl -fsSL https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip -o /tmp/python.zip \
    && unzip -q /tmp/python.zip -d /opt/mt5-dist/python \
    && sed -i 's/^#import site/import site/' /opt/mt5-dist/python/python311._pth \
    && printf '\nLib/site-packages\nZ:\\opt\\mt5-bridge\n' >> /opt/mt5-dist/python/python311._pth \
    && curl -fsSL https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe -o /opt/mt5-dist/mt5setup.exe
COPY requirements-wine.txt /opt/mt5-dist/requirements-wine.txt
RUN python3 -m pip install --no-cache-dir --no-compile --only-binary=:all: --platform win_amd64 --python-version 311 \
    --target /opt/mt5-dist/python/Lib/site-packages -r /opt/mt5-dist/requirements-wine.txt
COPY server.py healthcheck.py /opt/mt5-bridge/
COPY container-start.sh /dockerstartup/custom_startup.sh
RUN chmod 755 /dockerstartup/custom_startup.sh \
    && chown -R 1000:1000 /home/kasm-user
ENV WINEPREFIX=/home/kasm-user/.wine-mt5 WINEARCH=win64 WINEDEBUG=-all
USER 1000
