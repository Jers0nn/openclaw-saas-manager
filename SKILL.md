---
name: saas-manager
description: Manage SaaS customers, subscriptions, usage and business metrics. Use when the user asks about SaaS customers, subscriptions, billing, usage, MRR or account management.
---

# SaaS Manager

## Purpose

This skill helps an AI agent manage and interact with a SaaS platform.

Use this skill when the user wants to:

- Find SaaS customers
- Search customers by name or email
- View customer information
- Create customers
- Check subscriptions
- Check customer usage
- Analyze SaaS account information

## Customer Management

When the user asks about customers:

1. Identify whether they want to search, view or create a customer.
2. Ask for missing information when necessary.
3. Use the appropriate SaaS Manager tool.
4. Return a concise and clear result.

### Examples

User:

"Busca el cliente juan@example.com"

Action:

Use the customer search functionality.

User:

"Muéstrame los datos del cliente 123"

Action:

Retrieve customer 123.

User:

"Crea un cliente llamado Acme"

Action:

Ask for the required email address if it is not provided.

## Subscription Management

Use the subscription functionality when the user asks about:

- Active subscriptions
- Cancelled subscriptions
- Subscription status
- Customer plans
- Subscription information

## Usage

Use the usage functionality when the user asks:

- How much a customer has used
- Usage for a specific period
- Usage limits
- Consumption metrics

## Safety

Never invent customer information.

Never claim that a customer was created unless the SaaS API confirms the creation.

Never expose API keys, authentication tokens or other secrets.

When an API request fails, clearly explain that the request could not be completed.

## Response Style

Use simple language.

When returning customer information, organize the information clearly.

When returning metrics, include the relevant period.

If information is unavailable, say so instead of guessing.

Links
[Suiteka](https://suiteka.com)
