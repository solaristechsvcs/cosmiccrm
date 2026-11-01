FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates bash tini && rm -rf /var/lib/apt/lists/*
WORKDIR /home/container
RUN chown node:node /home/container
USER node
EXPOSE 3015
ENTRYPOINT ["/usr/bin/tini","--"]
# Bind-mount the git checkout at /home/container, including your local config.js.
CMD ["bash","scripts/start.sh"]
