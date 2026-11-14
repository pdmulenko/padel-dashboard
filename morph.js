// Перерисовка «на месте»: вместо замены всего innerHTML сравниваем старое и новое дерево и меняем
// только отличающееся. Кнопки и иконки остаются теми же элементами, поэтому не моргают,
// а фокус в полях ввода и прокрутка не сбиваются.

// Заменить содержимое element на html, сохранив совпадающие узлы
export function morphInner(element, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    morphChildren(element, template.content);
}

function morphChildren(from, to) {
    const next = [...to.childNodes];
    next.forEach((node, i) => {
        const current = from.childNodes[i];
        if (!current) from.appendChild(node);
        else if (!sameKind(current, node)) from.replaceChild(node, current);
        else if (node.nodeType === Node.ELEMENT_NODE) morphElement(current, node);
        else if (current.nodeValue !== node.nodeValue) current.nodeValue = node.nodeValue;
    });
    while (from.childNodes.length > next.length) from.lastChild.remove();
}

function sameKind(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

function morphElement(from, to) {
    // атрибуты
    for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
    for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
    // у полей ввода состояние живёт в свойствах, а не в атрибутах
    if (from.nodeName === 'INPUT') {
        if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
        else {
            const value = to.getAttribute('value') ?? '';
            if (from.value !== value) from.value = value;
        }
    }
    morphChildren(from, to);
}
