// javascript/ui/rows.js
// Универсальный компонент для отрисовки строк товаров (отгрузка, перерасчет, заказ, показания)

function renderProductRow(cfg) {
    const code = escapeHtml(cfg.code || '');
    const name = escapeHtml(cfg.name || '—');
    const price = Number(cfg.price) || 0;

    // Шапка строки (название и цена)
    const headPriceHtml = cfg.showHeadPrice !== false 
        ? `<span class="assort-row-price">Ціна: <strong>${fmt(price)} ₴</strong></span>` 
        : '';

    // Универсальный рендер колонки
    const renderCol = (col) => {
        if (!col) return '';

        let contentHtml = '';

            if (col.isInput) {
            const inputAttrs = col.inputAttrs || '';
            contentHtml = `
                <div class="qty">
                    <button type="button" class="qty-btn" data-step="-1" aria-label="Менше">−</button>
                    <input type="text" inputmode="numeric" class="qty-input ${col.inputClass || ''}" value="${col.inputValue}" ${inputAttrs}>
                    <button type="button" class="qty-btn" data-step="1" aria-label="Більше">+</button>
                </div>
            `;
        } else if (col.isStatic) {
            const style = col.isLarge ? 'style="font-size: 1.2rem; font-weight: 800; color: var(--text-heading);"' : '';
            const cls = col.className || 'assort-field-static';
            contentHtml = `<div class="${cls}" ${style}>${col.value}</div>`;
        } else if (col.isTotal) {
            // Добавляем оба класса (assort-row-total и row-total) для совместимости со старыми обработчиками
            contentHtml = `<div class="assort-row-total row-total">${col.value}</div>`;
        }

        return `
            <div>
                <label>${escapeHtml(col.label)}</label>
                ${contentHtml}
            </div>
        `;
    };

    return `
        <div class="meter-input-group assort-row ${cfg.rowClass || ''}" ${cfg.dataAttr || ''} data-idx="${cfg.idx || 0}" data-code="${code}" data-price="${price}">
            <div class="assort-row-head">
                <strong class="assort-tile-name drink-name">${name}</strong>
                ${headPriceHtml}
            </div>
            <div class="assort-row-fields ${cfg.fieldsClass || ''}">
                ${renderCol(cfg.col1)}
                ${renderCol(cfg.col2)}
                ${renderCol(cfg.col3)}
                ${renderCol(cfg.col4)}
            </div>
        </div>
    `;
}