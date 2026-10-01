# 📚 Gitmoji + Conventional Commits Guide

## Commit Format

```text
type(scope): emoji message

- detail 1
- detail 2
- detail 3
```

Example:

```text
feat(auth): ✨ implement JWT authentication

- Add JWT access and refresh tokens
- Configure security filters
- Protect private endpoints
```

---

# Gitmojis Reference

| Emoji | Purpose                                | Recommended Type | Example                                                |
| ----- | -------------------------------------- | ---------------- | ------------------------------------------------------ |
| 🎨    | Improve structure / format of the code | `style`          | `style(customer): 🎨 organize DTO packages`            |
| ⚡️    | Improve performance                    | `perf`           | `perf(cache): ⚡️ optimize Redis queries`               |
| 🔥    | Remove code or files                   | `refactor`       | `refactor(auth): 🔥 remove deprecated endpoints`       |
| 🐛    | Fix a bug                              | `fix`            | `fix(payment): 🐛 resolve duplicate transaction issue` |
| 🚑️    | Critical hotfix                        | `fix`            | `fix(api): 🚑️ patch production outage`                 |
| ✨    | Introduce new features                 | `feat`           | `feat(customer): ✨ add customer search filters`       |
| 📝    | Add or update documentation            | `docs`           | `docs(api): 📝 add Swagger examples`                   |
| 🚀    | Deploy stuff                           | `chore`          | `chore(deployment): 🚀 deploy production release`      |
| 💄    | Add or update UI and styles            | `feat`           | `feat(ui): 💄 redesign dashboard cards`                |
| 🎉    | Begin a project                        | `feat`           | `feat(pos-service): 🎉 initialize Spring Boot project` |
| ✅    | Add or update tests                    | `test`           | `test(customer): ✅ add unit tests`                    |
| 🔒️    | Fix security issues                    | `fix`            | `fix(auth): 🔒️ secure password reset flow`             |
| 🔐    | Add or update secrets                  | `chore`          | `chore(env): 🔐 update JWT secrets`                    |
| 🔖    | Release / version tags                 | `release`        | `release(api): 🔖 v1.2.0`                              |
| 🚨    | Fix compiler or linter warnings        | `fix`            | `fix(frontend): 🚨 resolve ESLint warnings`            |
| 🚧    | Work in progress                       | `feat`           | `feat(hostal): 🚧 implement reservation module`        |
| 💚    | Fix CI build                           | `ci`             | `ci(actions): 💚 fix GitHub Actions workflow`          |
| ⬇️    | Downgrade dependencies                 | `build`          | `build(api): ⬇️ downgrade PostgreSQL driver`           |
| ⬆️    | Upgrade dependencies                   | `build`          | `build(api): ⬆️ upgrade Spring Boot version`           |
| 📌    | Pin dependency versions                | `build`          | `build(gradle): 📌 pin Lombok version`                 |
| 👷    | Add or update CI build system          | `ci`             | `ci(github): 👷 add GitHub Actions pipeline`           |
| 📈    | Add analytics or tracking              | `feat`           | `feat(metrics): 📈 add usage tracking`                 |
| ♻️    | Refactor code                          | `refactor`       | `refactor(invoice): ♻️ simplify service layer`         |
| ➕    | Add a dependency                       | `build`          | `build(frontend): ➕ add shadcn dependencies`          |
| ➖    | Remove a dependency                    | `build`          | `build(api): ➖ remove springfox`                      |
| 🔧    | Update configuration files             | `chore`          | `chore(config): 🔧 update application.yml`             |
| 🔨    | Update development scripts             | `chore`          | `chore(scripts): 🔨 add backup script`                 |
| 🌐    | Internationalization and localization  | `feat`           | `feat(i18n): 🌐 add Spanish translations`              |
| ✏️    | Fix typos                              | `docs`           | `docs(readme): ✏️ fix spelling mistakes`               |
| 💩    | Code that needs improvement            | `wip`            | `wip(service): 💩 temporary implementation`            |
| ⏪️    | Revert changes                         | `revert`         | `revert(api): ⏪️ revert invoice changes`               |
| 🔀    | Merge branches                         | `merge`          | `merge(develop): 🔀 merge feature/customer-module`     |
| 📦️    | Update compiled files or packages      | `build`          | `build(frontend): 📦️ update compiled assets`           |
| 👽️    | External API changes                   | `fix`            | `fix(payment): 👽️ adapt to Stripe API changes`         |
| 🚚    | Move or rename resources               | `refactor`       | `refactor(customer): 🚚 move DTO packages`             |
| 📄    | Add or update license                  | `docs`           | `docs(project): 📄 add MIT license`                    |
| 💥    | Introduce breaking changes             | `feat`           | `feat(api): 💥 migrate to v2 contracts`                |
| 🍱    | Add or update assets                   | `feat`           | `feat(ui): 🍱 add dashboard images`                    |
| ♿️    | Improve accessibility                  | `feat`           | `feat(ui): ♿️ improve keyboard navigation`             |
| 💡    | Add source code comments               | `docs`           | `docs(service): 💡 document methods`                   |
| 🍻    | Experimental coding                    | `wip`            | `wip(test): 🍻 quick prototype implementation`         |
| 💬    | Update text and literals               | `feat`           | `feat(ui): 💬 update validation messages`              |
| 🗃️    | Database changes                       | `feat`           | `feat(database): 🗃️ create invoice tables`             |
| 🔊    | Add logs                               | `feat`           | `feat(api): 🔊 add request logs`                       |
| 🔇    | Remove logs                            | `refactor`       | `refactor(api): 🔇 remove debug logs`                  |
| 👥    | Add or update contributors             | `docs`           | `docs(project): 👥 add contributors section`           |
| 🚸    | Improve user experience                | `feat`           | `feat(pos): 🚸 simplify checkout flow`                 |
| 🏗️    | Architectural changes                  | `refactor`       | `refactor(system): 🏗️ migrate to microservices`        |
| 📱    | Responsive design                      | `feat`           | `feat(layout): 📱 improve mobile experience`           |
| 🤡    | Mock things                            | `test`           | `test(api): 🤡 mock external services`                 |
| 🥚    | Easter eggs                            | `feat`           | `feat(game): 🥚 add hidden mode`                       |
| 🙈    | Update .gitignore                      | `chore`          | `chore(git): 🙈 update .gitignore`                     |
| 📸    | Update snapshots                       | `test`           | `test(ui): 📸 update snapshots`                        |
| ⚗️    | Experiments                            | `experiment`     | `experiment(ai): ⚗️ evaluate vector search`            |
| 🔍️    | Improve SEO                            | `feat`           | `feat(web): 🔍️ improve metadata`                       |
| 🏷️    | Add or update types                    | `refactor`       | `refactor(shared): 🏷️ add TypeScript types`            |
| 🌱    | Add seed files                         | `feat`           | `feat(seed): 🌱 add demo customers`                    |
| 🚩    | Feature flags                          | `feat`           | `feat(system): 🚩 add beta feature toggle`             |
| 🥅    | Catch errors                           | `fix`            | `fix(api): 🥅 handle null responses`                   |
| 💫    | Add animations                         | `feat`           | `feat(ui): 💫 add loading transitions`                 |
| 🗑️    | Deprecate code                         | `refactor`       | `refactor(api): 🗑️ deprecate v1 endpoints`             |
| 🛂    | Authorization and permissions          | `feat`           | `feat(auth): 🛂 implement RBAC permissions`            |
| 🩹    | Simple fix                             | `fix`            | `fix(ui): 🩹 adjust button spacing`                    |
| 🧐    | Data exploration                       | `chore`          | `chore(database): 🧐 inspect duplicated records`       |
| ⚰️    | Remove dead code                       | `refactor`       | `refactor(service): ⚰️ remove unused methods`          |
| 🧪    | Add failing tests                      | `test`           | `test(auth): 🧪 reproduce refresh token bug`           |
| 👔    | Business logic                         | `feat`           | `feat(finance): 👔 implement discount policies`        |
| 🩺    | Health checks                          | `feat`           | `feat(system): 🩺 add actuator health endpoint`        |
| 🧱    | Infrastructure changes                 | `chore`          | `chore(docker): 🧱 add Docker Compose services`        |
| 🧑‍💻    | Developer experience                   | `chore`          | `chore(dev): 🧑‍💻 configure VS Code tasks`               |
| 💸    | Financial infrastructure               | `chore`          | `chore(billing): 💸 configure sponsorship system`      |
| 🧵    | Multithreading or concurrency          | `perf`           | `perf(worker): 🧵 improve concurrent processing`       |
| 🦺    | Validation logic                       | `feat`           | `feat(customer): 🦺 validate request payloads`         |
| ✈️    | Offline support                        | `feat`           | `feat(pwa): ✈️ add offline caching`                    |
| 🦖    | Backward compatibility                 | `feat`           | `feat(api): 🦖 support legacy clients`                 |

---

# Recommended Commit Structure

```text
feat(scope): ✨ message

- detail 1
- detail 2
- detail 3
```

```text
fix(scope): 🐛 message

- detail 1
- detail 2
- detail 3
```

```text
refactor(scope): ♻️ message

- detail 1
- detail 2
- detail 3
```

```text
build(scope): ➕ message

- detail 1
- detail 2
- detail 3
```

```text
docs(scope): 📝 message

- detail 1
- detail 2
- detail 3
```
