function paginateList(list, paginationStateOrKey, defaultPageSize, globalState) {
  list = list || [];
  var p = (typeof paginationStateOrKey === 'object' && paginationStateOrKey !== null)
    ? paginationStateOrKey
    : (globalState && globalState.pagination && globalState.pagination[paginationStateOrKey])
      ? globalState.pagination[paginationStateOrKey]
      : (typeof window !== 'undefined' && window.state && window.state.pagination && window.state.pagination[paginationStateOrKey])
        ? window.state.pagination[paginationStateOrKey]
        : { page: 1, pageSize: defaultPageSize || 20 };

  if (defaultPageSize && !p.customSize) {
    p.pageSize = defaultPageSize;
  }
  var total = list.length;
  var pageSize = Math.max(1, Number(p.pageSize) || 20);
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var page = Math.min(Math.max(1, Number(p.page) || 1), totalPages);
  p.page = page;

  var startIndex = (page - 1) * pageSize;
  var endIndex = Math.min(startIndex + pageSize, total);
  var items = list.slice(startIndex, endIndex);

  return {
    items: items,
    total: total,
    page: page,
    totalPages: totalPages,
    startIndex: startIndex,
    endIndex: endIndex,
    pageSize: pageSize
  };
}

function setPaginationPage(key, newPage, rerenderFn, globalState) {
  var st = globalState || (typeof window !== 'undefined' ? window.state : null);
  var p = (st && st.pagination && st.pagination[key])
    ? st.pagination[key]
    : (typeof key === 'object' ? key : null);
  if (p) {
    p.page = Math.max(1, Number(newPage) || 1);
  }
  if (typeof rerenderFn === 'function') {
    rerenderFn();
  } else if (typeof window !== 'undefined' && typeof window[rerenderFn] === 'function') {
    window[rerenderFn]();
  }
}

function setPaginationPageSize(key, newSize, rerenderFn, globalState) {
  var st = globalState || (typeof window !== 'undefined' ? window.state : null);
  var p = (st && st.pagination && st.pagination[key])
    ? st.pagination[key]
    : (typeof key === 'object' ? key : null);
  if (p) {
    p.pageSize = Math.max(1, Number(newSize) || 20);
    p.customSize = true;
    p.page = 1;
  }
  if (typeof rerenderFn === 'function') {
    rerenderFn();
  } else if (typeof window !== 'undefined' && typeof window[rerenderFn] === 'function') {
    window[rerenderFn]();
  }
}

function renderPaginationControls(key, paginatedData, rerenderFnName) {
  if (!paginatedData) return '';
  var total = paginatedData.total || 0;
  var page = paginatedData.page || 1;
  var totalPages = paginatedData.totalPages || 1;
  var startIndex = paginatedData.startIndex || 0;
  var endIndex = paginatedData.endIndex || 0;
  var pageSize = paginatedData.pageSize || 20;

  if (!total || total === 0) return '';

  var showingText = 'A mostrar <strong>' + (startIndex + 1) + '</strong> a <strong>' + endIndex + '</strong> de <strong>' + total + '</strong> registos';

  if (totalPages <= 1 && total <= pageSize) {
    return '<div class="pagination-bar single-page"><div class="pagination-info">' + showingText + '</div></div>';
  }

  var pageButtons = [];
  var delta = 2;
  var left = Math.max(1, page - delta);
  var right = Math.min(totalPages, page + delta);

  if (left > 1) {
    pageButtons.push('<button type="button" class="page-btn" onclick="setPaginationPage(\'' + key + '\', 1, \'' + rerenderFnName + '\')">1</button>');
    if (left > 2) {
      pageButtons.push('<span class="page-ellipsis">…</span>');
    }
  }

  for (var i = left; i <= right; i++) {
    if (i === page) {
      pageButtons.push('<button type="button" class="page-btn active" aria-current="page">' + i + '</button>');
    } else {
      pageButtons.push('<button type="button" class="page-btn" onclick="setPaginationPage(\'' + key + '\', ' + i + ', \'' + rerenderFnName + '\')">' + i + '</button>');
    }
  }

  if (right < totalPages) {
    if (right < totalPages - 1) {
      pageButtons.push('<span class="page-ellipsis">…</span>');
    }
    pageButtons.push('<button type="button" class="page-btn" onclick="setPaginationPage(\'' + key + '\', ' + totalPages + ', \'' + rerenderFnName + '\')">' + totalPages + '</button>');
  }

  var prevDisabled = page <= 1 ? 'disabled' : '';
  var nextDisabled = page >= totalPages ? 'disabled' : '';

  var prevBtn = '<button type="button" class="page-btn page-arrow" ' + prevDisabled + ' onclick="setPaginationPage(\'' + key + '\', ' + (page - 1) + ', \'' + rerenderFnName + '\')" title="Página anterior">‹</button>';
  var nextBtn = '<button type="button" class="page-btn page-arrow" ' + nextDisabled + ' onclick="setPaginationPage(\'' + key + '\', ' + (page + 1) + ', \'' + rerenderFnName + '\')" title="Página seguinte">›</button>';

  var sizes = [10, 20, 50];
  var sizeOptions = sizes.map(function(s) {
    return '<option value="' + s + '" ' + (pageSize === s ? 'selected' : '') + '>' + s + ' / pág.</option>';
  }).join('');

  var sizeSelect = '<div class="pagination-size-wrap">' +
    '<select class="pagination-size-select" onchange="setPaginationPageSize(\'' + key + '\', this.value, \'' + rerenderFnName + '\')" title="Registos por página">' +
    sizeOptions +
    '</select>' +
  '</div>';

  return '<div class="pagination-bar">' +
    '<div class="pagination-info">' + showingText + '</div>' +
    '<div class="pagination-actions">' +
      sizeSelect +
      '<div class="pagination-nav">' +
        prevBtn +
        pageButtons.join('') +
        nextBtn +
      '</div>' +
    '</div>' +
  '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    paginateList: paginateList,
    setPaginationPage: setPaginationPage,
    setPaginationPageSize: setPaginationPageSize,
    renderPaginationControls: renderPaginationControls
  };
}
if (typeof window !== 'undefined') {
  window.paginateList = paginateList;
  window.setPaginationPage = setPaginationPage;
  window.setPaginationPageSize = setPaginationPageSize;
  window.renderPaginationControls = renderPaginationControls;
}
