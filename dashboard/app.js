// Token Launch Radar - Interactive Dashboard
// Reads /output/data.js written by main.ts
// No framework, no network requests - all data inline

// Global state
let allRows = [];
let filteredRows = [];
let currentFilters = {
    category: '',
    confidence: ''
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Load data from the inline script
    const dataScript = document.currentScript ? document.currentScript.previousElementSibling : null;
    
    // We'll get data from the global window.RADAR set by data.js
    if (typeof window !== 'undefined' && window.RADAR) {
        initDashboard(window.RADAR);
    } else {
        // Fallback: try to load from data.js file
        loadDataScript();
    }
});

function initDashboard(radarData) {
    allRows = radarData.rows;
    filteredRows = [...allRows];
    
    // Update summary stats
    updateSummaryStats();
    
    // Populate category filter
    populateCategoryFilter();
    
    // Render tables
    renderTable(allRows, 'radar-tbody', 'radar');
    renderLiveTable(radarData.live);
    
    // Add event listeners
    addEventListeners();
}

function loadDataScript() {
    const script = document.createElement('script');
    script.src = '/output/data.js';
    script.defer = true;
    document.body.appendChild(script);
    
    script.addEventListener('load', function() {
        if (window.RADAR) {
            initDashboard(window.RADAR);
        }
    });
}

function updateSummaryStats() {
    const totalEl = document.getElementById('total-rows');
    const earlyEl = document.getElementById('early-count');
    const liveEl = document.getElementById('live-count');
    
    totalEl.textContent = filteredRows.length;
    earlyEl.textContent = filteredRows.filter(r => !window.RADAR.watchlist.includes(r.slug)).length;
    liveEl.textContent = radarData.live.length;
}

function populateCategoryFilter() {
    const categoryFilter = document.getElementById('category-filter');
    
    // Get unique categories
    const categories = [...new Set(allRows.map(r => r.category).filter(c => c))].sort();
    
    // Clear existing options (except the "All" option)
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    });
}

function addEventListeners() {
    // Category filter
    document.getElementById('category-filter').addEventListener('change', function(e) {
        applyFilters();
    });
    
    // Confidence filter
    document.getElementById('confidence-filter').addEventListener('change', function(e) {
        applyFilters();
    });
    
    // Reset filters
    document.getElementById('reset-filters').addEventListener('click', function() {
        document.getElementById('category-filter').value = '';
        document.getElementById('confidence-filter').value = '';
        applyFilters();
    });
    
    // Table row click for detail view
    document.getElementById('radar-table').addEventListener('click', function(e) {
        const row = e.target.closest('tr');
        if (row && !row.classList.contains('header')) {
            const slug = row.dataset.slug;
            showDetail(slug);
        }
    });
    
    // Close detail view
    document.getElementById('close-detail').addEventListener('click', function() {
        hideDetail();
    });
    
    // Click outside to close
    window.addEventListener('click', function(e) {
        if (e.target.id === 'detail-view') {
            hideDetail();
        }
    });
}

function applyFilters() {
    const categoryFilter = document.getElementById('category-filter').value;
    const confidenceFilter = document.getElementById('confidence-filter').value;
    
    let results = [...allRows];
    
    // Apply category filter
    if (categoryFilter) {
        results = results.filter(r => r.category_multiplier && r.category_multiplier.toString().includes(categoryFilter.split('-')[0]) || r.category === categoryFilter);
    }
    
    // Actually, let's filter by the category name stored in the row
    // We need to check the original category from the model
    // Since we have category_multiplier, let's map it back or use a different approach
    // For now, filter by the category text if available
    if (categoryFilter) {
        results = results.filter(r => r.category === categoryFilter || (!categoryFilter && true));
    }
    
    // Apply confidence filter
    if (confidenceFilter) {
        const gradeMap = { 'A': 0.85, 'B': 0.75, 'C': 0.60, 'D': 0 };
        const minConf = gradeMap[confidenceFilter] || 0;
        results = results.filter(r => r.confidence >= minConf);
    }
    
    filteredRows = results;
    updateSummaryStats();
    renderTable(filteredRows, 'radar-tbody', 'radar');
}

function renderTable(rows, tbodyId, tableType) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    
    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.dataset.slug = row.slug;
        
        // Determine rank color
        let rankClass = '';
        if (index === 0) rankClass = 'rank-1';
        else if (index === 1) rankClass = 'rank-2';
        else if (index === 2) rankClass = 'rank-3';
        
        const changeClass = row.change_7d !== null ? (row.change_7d >= 0 ? 'change-positive' : 'change-negative') : '';
        
        tr.innerHTML = `
            <td><span class="${rankClass}">${index + 1}</span></td>
            <td><strong>${row.name}</strong><br><span class="muted">${row.slug}</span></td>
            <td>${row.category || 'N/A'}</td>
            <td>${row.chains.join(', ')}</td>
            <td><span class="${changeClass}">${row.change_7d !== null ? (row.change_7d >= 0 ? '+' : '') + (row.change_7d * 100).toFixed(1) + '%' : 'N/A'}</span></td>
            <td>${formatNumber(row.tvl_usd)}</td>
            <td>${formatNumber(row.implied_value_usd)}</td>
            <td>${row.confidence.toFixed(2)}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function renderLiveTable(liveRows) {
    const tbody = document.getElementById('live-tbody');
    tbody.innerHTML = '';
    
    liveRows.forEach((row, index) => {
        const tr = document.createElement('tr');
        
        const changeClass = row.change_7d !== null ? (row.change_7d >= 0 ? 'change-positive' : 'change-negative') : '';
        
        tr.innerHTML = `
            <td><strong>${row.name}</strong></td>
            <td>${row.category || 'N/A'}</td>
            <td>${formatNumber(row.tvl_usd)}</td>
            <td>${formatNumber(row.mcap_usd)}</td>
            <td><span class="${changeClass}">${row.change_7d !== null ? (row.change_7d >= 0 ? '+' : '') + (row.change_7d * 100).toFixed(1) + '%' : 'N/A'}</span></td>
        `;
        
        tbody.appendChild(tr);
    });
}

function showDetail(slug) {
    const row = allRows.find(r => r.slug === slug);
    if (!row) return;
    
    const detailView = document.getElementById('detail-view');
    const detailName = document.getElementById('detail-name');
    const detailSlug = document.getElementById('detail-slug');
    const detailCategory = document.getElementById('detail-category');
    const detailChains = document.getElementById('detail-chains');
    const detailTvl = document.getElementById('detail-tvl');
    const detailAge = document.getElementById('detail-age');
    const detailChange = document.getElementById('detail-change');
    const detailImplied = document.getElementById('detail-implied');
    const detailMcap = document.getElementById('detail-mcap');
    const detailCatMult = document.getElementById('detail-cat-mult');
    const detailGrowthMult = document.getElementById('detail-growth-mult');
    const detailMaturityMult = document.getElementById('detail-maturity-mult');
    const detailChainBonus = document.getElementById('detail-chain-bonus');
    const detailConf = document.getElementById('detail-conf');
    const detailSteps = document.getElementById('detail-steps');
    
    detailName.textContent = row.name;
    detailSlug.textContent = row.slug;
    detailCategory.textContent = row.category || 'N/A';
    detailChains.textContent = row.chains.join(', ');
    detailTvl.textContent = formatNumber(row.tvl_usd);
    detailAge.textContent = row.age_days !== null ? `${row.age_days}d` : 'Unknown';
    detailChange.textContent = row.change_7d !== null ? (row.change_7d >= 0 ? '+' : '') + (row.change_7d * 100).toFixed(1) + '%' : 'N/A';
    detailImplied.textContent = formatNumber(row.implied_value_usd);
    detailMcap.textContent = row.mcap_usd !== null ? formatNumber(row.mcap_usd) : 'N/A';
    detailCatMult.textContent = row.category_multiplier.toFixed(2) + 'x';
    detailGrowthMult.textContent = row.growth_multiplier.toFixed(2) + 'x';
    detailMaturityMult.textContent = row.maturity_multiplier.toFixed(2) + 'x';
    detailChainBonus.textContent = row.chain_bonus.toFixed(2);
    detailConf.textContent = row.confidence.toFixed(2);
    
    // Generate farm steps list
    detailSteps.innerHTML = '';
    if (row.farm_steps) {
        row.farm_steps.forEach(step => {
            const li = document.createElement('li');
            li.textContent = step;
            detailSteps.appendChild(li);
        });
    }
    
    detailView.classList.remove('hidden');
    detailView.style.display = 'block';
}

function hideDetail() {
    const detailView = document.getElementById('detail-view');
    detailView.classList.add('hidden');
    detailView.style.display = 'none';
}

function formatNumber(num) {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1) + 'B';
    } else if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}