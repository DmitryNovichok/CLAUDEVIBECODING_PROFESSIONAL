# Очистка опубликованных данных из истории GitHub

Удаление файлов новым коммитом не удаляет старые версии. Скрипт ниже запускает владелец
из отдельного каталога на компьютере с авторизованным GitHub CLI / Git credential manager.
Он не работает с `/opt/trainer` и не удаляет боевую базу.

Перед очисткой остановите отправку коммитов другими разработчиками, отзовите сессии и смените
пароли. После очистки все участники должны заново клонировать репозиторий. Старые клоны нельзя
пушить: они вернут удалённые данные. SHA коммитов изменятся; для деплоя используйте новую вершину.

```bash
python3 -m pip install git-filter-repo
git clone --mirror https://github.com/DmitryNovichok/CLAUDEVIBECODING_PROFESSIONAL.git egeshka-clean.git
cd egeshka-clean.git
git filter-repo --sensitive-data-removal --invert-paths --path server_data/ --path-glob '*.csv' --path-glob '*.db' --path-glob '*.db-*' --path-glob '*.sqlite' --path-glob '*.sqlite3' --path-glob '*.bak'
git remote add origin https://github.com/DmitryNovichok/CLAUDEVIBECODING_PROFESSIONAL.git
# Перезаписываются все ветки и теги: база могла попасть не только в рабочую ветку.
git push --force --all origin
git push --force --tags origin
git rev-parse refs/heads/claude/modest-dijkstra-js2e0u
```

Проверка путей: `git log --all -- server_data/` не должен возвращать коммиты.
Другие резервные копии/архивы следует проверять отдельно по именам и составу, не публикуя содержимое.
Попросите поддержку GitHub удалить кешированные представления, ссылки pull request и недостижимые
объекты с чувствительными данными (передайте отчёт git-filter-repo). Чужие клоны и скачанные архивы
отозвать нельзя. Поэтому очистка истории не заменяет смену паролей и токенов.

Эта процедура намеренно отделена от обычного деплоя и CI: автоматический force push всех веток
на каждом обновлении недопустим.
