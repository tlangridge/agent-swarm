FROM node:22-slim

RUN apt-get update && apt-get install -y curl git bash unzip && rm -rf /var/lib/apt/lists/*

# Install Bun (needed for Claude Code)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Install Gemini CLI
RUN npm install -g @google/gemini-cli

# Install Codex CLI
RUN npm install -g @openai/codex

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash agent
RUN cp -r /root/.bun /home/agent/.bun && chown -R agent:agent /home/agent/.bun

USER agent
ENV PATH="/home/agent/.bun/bin:$PATH"
WORKDIR /home/agent/workspace
CMD ["/bin/bash"]
