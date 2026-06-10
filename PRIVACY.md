# Privacy Policy - TokenLens

**Last Updated: June 10, 2026**

## Overview

TokenLens is a VS Code extension designed to monitor and track LLM API usage for AI development tools. This privacy policy explains how we handle your data.

## Data Collection & Storage

### Local-Only Storage
- **All data is stored locally**: TokenLens stores all usage metrics, API keys, and configuration settings exclusively in VS Code's `globalState` on your local machine.
- **No data transmission**: We do not collect, transmit, or store any of your data on external servers. Your information never leaves your computer.

### What We Monitor
TokenLens monitors the following types of data:
- **API Request Metadata**: Model names, token counts (input/output), timestamps, and response status codes from LLM API calls.
- **Cost Calculations**: Estimated costs based on configured pricing tables.
- **Account Balances**: Current account balances from supported providers (DeepSeek, Kimi, etc.) when you provide API keys.
- **Cache Hit Rates**: Information about cache hits/misses for models that support caching.

### HTTP Interception
TokenLens uses HTTP interception technology to capture API requests made by other VS Code extensions (such as Continue, Cline, Aider, etc.). This interception:
- **Only targets known LLM API domains**: We only intercept requests to documented LLM provider endpoints (e.g., `api.deepseek.com`, `api.openai.com`, `api.anthropic.com`).
- **Does not modify requests**: All intercepted requests are forwarded unchanged to their original destinations.
- **Does not log sensitive content**: We do not store request bodies containing your prompts, code, or other sensitive information—only metadata like token counts and model names.

## API Keys & Credentials

If you choose to configure API keys for balance checking:
- **Stored locally only**: API keys are encrypted and stored in VS Code's secure global state.
- **Never transmitted**: Your API keys are never sent to our servers or any third-party service.
- **Used solely for queries**: API keys are only used to query official provider APIs for account balance information.

## Third-Party Services

TokenLens does not integrate with any third-party analytics, tracking, or telemetry services. All functionality operates entirely within your local VS Code environment.

## Data Retention & Deletion

- **Retention**: Usage history is retained indefinitely unless you manually clear it through the extension's "Reset Session" feature.
- **Deletion**: You can delete all stored data at any time by:
  1. Running the command `TokenLens: Reset Session`
  2. Uninstalling the extension (data remains in VS Code global state until manually cleared)
  3. Manually clearing VS Code extension storage via the Command Palette

## Security Considerations

While we implement best practices for local data security:
- **Local access**: Any application or user with access to your VS Code global state could potentially read stored data.
- **Recommendation**: Only use this extension on trusted machines where you control access.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted in this document with an updated revision date.

## Contact

If you have questions or concerns about this privacy policy, please open an issue on our [GitHub repository](https://github.com/JohnsonJinyu/TokenLens-Monitor/issues).

## License

This extension is open-source under the [MIT License](LICENSE). You are welcome to review the source code to verify our privacy claims.
