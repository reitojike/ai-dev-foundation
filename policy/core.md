# Foundation core policy

## Source of truth

This directory is the canonical source for Foundation-wide normative rules.
Consumers receive generated adapters; generated files are not an authoring
surface.

Rules are composed in this order:

1. Foundation policy: rules that apply to every consumer.
2. Technology profile: rules that apply to a chosen stack.
3. Consumer product rules: rules that are specific to one product.

## Separation of responsibilities

- A **policy** states what is required or prohibited.
- A **skill** explains how to carry out work using a policy; it does not copy
  normative rules.
- A **profile** concretizes a policy for a technology or provider; it does not
  contain product-domain rules.
- A **generated adapter** distributes the composed rules to a consumer.

Do not restate the same normative rule in a Skill, Profile, or generated
adapter source. Reference the owning rule instead.

## Generated adapters

`AGENTS.md` is generated from the three composition inputs. Do not edit it
directly. `CLAUDE.md` is a thin adapter that points to `AGENTS.md`; it must not
duplicate the canonical rules.
