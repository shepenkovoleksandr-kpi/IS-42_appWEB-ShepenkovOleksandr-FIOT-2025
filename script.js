let currentUser = null;
let allListings = [];

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await initAuthUI();
    await loadListings();
    attachFormHandlers();
    attachFavoriteHandlers();
    attachAdminHandlers();
}

// === AUTH FUNCTIONS ===
async function initAuthUI() {
    try {
        currentUser = await getStatus();
        updateAccountArea(currentUser);
        updateUIForUser(currentUser);
    } catch (e) {
        console.error('Status error:', e);
        currentUser = { role: 'guest', name: 'Гість' };
        updateAccountArea(currentUser);
    }
}

async function getStatus() {
    const res = await fetch('/api/status', { credentials: 'include' });
    if (!res.ok) throw new Error('Status fetch failed');
    const data = await res.json();
    return data.user || { role: 'guest', name: 'Гість' };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function updateAccountArea(user) {
    const area = document.getElementById('accountArea');
    if (!area) return;

    if (user && user.role && user.role !== 'guest') {
        area.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <span class="me-2">Привіт, <strong>${escapeHtml(user.name)}</strong></span>
                ${user.role === 'admin' ? '<span class="badge bg-danger">Admin</span>' : ''}
                <button id="myFavBtn" class="btn btn-sm btn-outline-primary">❤️ Улюблене</button>
                <button id="logoutBtn" class="btn btn-sm btn-outline-secondary">Вихід</button>
            </div>
        `;
        
        document.getElementById('logoutBtn')?.addEventListener('click', logout);
        document.getElementById('myFavBtn')?.addEventListener('click', showMyFavorites);
    } else {
        area.innerHTML = `
            <button class="btn btn-outline-danger" data-bs-toggle="modal" data-bs-target="#authModal">
                Особистий кабінет
            </button>
        `;
    }
}

function updateUIForUser(user) {
    // Show admin panel if admin
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) {
        adminPanel.style.display = user.role === 'admin' ? 'block' : 'none';
    }

    // Update favorites link
    const favLink = document.getElementById('favoritesLink');
    if (favLink) {
        if (user.role === 'guest') {
            favLink.style.opacity = '0.5';
            favLink.style.cursor = 'not-allowed';
            favLink.onclick = (e) => {
                e.preventDefault();
                alert('Увійдіть, щоб переглянути улюблене');
            };
        } else {
            favLink.style.opacity = '1';
            favLink.style.cursor = 'pointer';
            favLink.onclick = (e) => {
                e.preventDefault();
                showMyFavorites();
            };
        }
    }
}

function attachFormHandlers() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const errEl = document.getElementById('loginError');
            errEl.style.display = 'none';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (!res.ok) {
                    errEl.textContent = data.error || 'Помилка входу';
                    errEl.style.display = 'block';
                    return;
                }
                
                closeModal('authModal');
                currentUser = data.user;
                updateAccountArea(currentUser);
                updateUIForUser(currentUser);
                await loadListings();
                loginForm.reset();
            } catch (e) {
                errEl.textContent = 'Помилка мережі';
                errEl.style.display = 'block';
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;
            const name = document.getElementById('regName').value.trim();
            const errEl = document.getElementById('regError');
            errEl.style.display = 'none';

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, name })
                });
                const data = await res.json();
                if (!res.ok) {
                    errEl.textContent = data.error || 'Помилка реєстрації';
                    errEl.style.display = 'block';
                    return;
                }
                
                closeModal('authModal');
                currentUser = data.user;
                updateAccountArea(currentUser);
                updateUIForUser(currentUser);
                await loadListings();
                registerForm.reset();
            } catch (e) {
                errEl.textContent = 'Помилка мережі';
                errEl.style.display = 'block';
            }
        });
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
        console.error('Logout error:', e);
    }
    currentUser = { role: 'guest', name: 'Гість' };
    updateAccountArea(currentUser);
    updateUIForUser(currentUser);
    await loadListings();
}

function closeModal(modalId) {
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
        const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        bsModal.hide();
    }
}

// === LISTINGS FUNCTIONS ===
async function loadListings() {
    try {
        const res = await fetch('/api/listings', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load listings');
        allListings = await res.json();
        displayListings(allListings);
        
        if (currentUser && currentUser.role === 'admin') {
            displayAdminListings(allListings);
        }
    } catch (e) {
        console.error('Load listings error:', e);
        document.getElementById('listingsContainer').innerHTML = 
            '<div class="col-12 text-center text-danger">Помилка завантаження оголошень</div>';
    }
}

function displayListings(listings) {
    const container = document.getElementById('listingsContainer');
    if (!container) return;

    if (!listings || listings.length === 0) {
        container.innerHTML = '<div class="col-12 text-center">Поки немає оголошень</div>';
        return;
    }

    container.innerHTML = listings.map(listing => `
        <div class="col-md-6 col-lg-4 mb-4">
            <div class="card listing-card">
                <div class="card-img-wrapper">
                    <img src="${escapeHtml(listing.image || 'img/main-car.png')}" 
                         class="card-img-top listing-img" 
                         alt="${escapeHtml(listing.title)}">
                    ${currentUser && currentUser.role !== 'guest' ? `
                        <button class="btn btn-sm favorite-btn ${listing.isFavorite ? 'btn-danger' : 'btn-outline-danger'}" 
                                data-fav-id="${listing.id}">
                            ${listing.isFavorite ? '❤️' : '🤍'}
                        </button>
                    ` : ''}
                </div>
                <div class="card-body">
                    <h5 class="card-title">${escapeHtml(listing.title)}</h5>
                    <p class="price-badge">${listing.price.toLocaleString()}</p>
                    ${listing.year ? `<p class="mb-1"><small>📅 Рік: ${listing.year}</small></p>` : ''}
                    ${listing.mileage ? `<p class="mb-2"><small>🛣️ Пробіг: ${listing.mileage.toLocaleString()} км</small></p>` : ''}
                    <p class="card-text text-muted">${escapeHtml(listing.description || '')}</p>
                </div>
            </div>
        </div>
    `).join('');
}

function displayAdminListings(listings) {
    const container = document.getElementById('adminListings');
    if (!container) return;

    if (!listings || listings.length === 0) {
        container.innerHTML = '<p>Немає оголошень для управління</p>';
        return;
    }

    container.innerHTML = `
        <table class="table table-striped">
            <thead>
                <tr>
                    <th>Назва</th>
                    <th>Ціна</th>
                    <th>Рік</th>
                    <th>Пробіг</th>
                    <th>Дії</th>
                </tr>
            </thead>
            <tbody>
                ${listings.map(l => `
                    <tr>
                        <td>${escapeHtml(l.title)}</td>
                        <td>${l.price.toLocaleString()}</td>
                        <td>${l.year || '-'}</td>
                        <td>${l.mileage ? l.mileage.toLocaleString() + ' км' : '-'}</td>
                        <td>
                            <button class="btn btn-sm btn-warning edit-listing-btn" data-id="${l.id}">✏️ Редагувати</button>
                            <button class="btn btn-sm btn-danger delete-listing-btn" data-id="${l.id}">🗑️ Видалити</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// === FAVORITES FUNCTIONS ===
function attachFavoriteHandlers() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-fav-id]');
        if (!btn) return;
        e.preventDefault();
        
        if (!currentUser || currentUser.role === 'guest') {
            alert('Увійдіть, щоб додавати в улюблене');
            return;
        }

        const id = btn.getAttribute('data-fav-id');
        try {
            const res = await fetch(`/api/listings/${encodeURIComponent(id)}/favorite`, {
                method: 'POST',
                credentials: 'include'
            });
            
            if (res.status === 401) {
                alert('Потрібно увійти, щоб додавати улюблене.');
                return;
            }
            
            const data = await res.json();
            if (res.ok) {
                // Update button appearance
                const isFav = data.favorited;
                btn.classList.toggle('btn-danger', isFav);
                btn.classList.toggle('btn-outline-danger', !isFav);
                btn.textContent = isFav ? '❤️' : '🤍';
                
                // Update listing in array
                const listing = allListings.find(l => l.id === id);
                if (listing) {
                    listing.isFavorite = isFav;
                }
            } else {
                alert(data.error || 'Помилка');
            }
        } catch (e) {
            console.error('Favorite error:', e);
            alert('Помилка мережі');
        }
    });
}

async function showMyFavorites() {
    if (!currentUser || currentUser.role === 'guest') {
        alert('Увійдіть, щоб переглянути улюблене');
        return;
    }

    try {
        const res = await fetch('/api/me/favorites', { credentials: 'include' });
        if (res.status === 401) {
            alert('Потрібно увійти.');
            return;
        }
        const data = await res.json();
        const favorites = data.favorites || [];
        
        if (favorites.length === 0) {
            alert('У вас поки немає улюблених оголошень');
            return;
        }

        const titles = favorites.map(f => `• ${f.title} - ${f.price.toLocaleString()}`).join('\n');
        alert(`Ваші улюблені автомобілі (${favorites.length}):\n\n${titles}`);
    } catch (e) {
        console.error(e);
        alert('Не вдалося отримати улюблене');
    }
}

// === ADMIN FUNCTIONS ===
function attachAdminHandlers() {
    // Save listing button
    const saveBtn = document.getElementById('saveListingBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveListingHandler);
    }

    // Edit and Delete buttons (event delegation)
    document.addEventListener('click', async (e) => {
        // Edit button
        if (e.target.closest('.edit-listing-btn')) {
            const btn = e.target.closest('.edit-listing-btn');
            const id = btn.getAttribute('data-id');
            editListing(id);
        }

        // Delete button
        if (e.target.closest('.delete-listing-btn')) {
            const btn = e.target.closest('.delete-listing-btn');
            const id = btn.getAttribute('data-id');
            deleteListing(id);
        }
    });

    // Reset form when modal opens
    const addModal = document.getElementById('addListingModal');
    if (addModal) {
        addModal.addEventListener('show.bs.modal', () => {
            resetListingForm();
        });
    }
}

function resetListingForm() {
    document.getElementById('listingId').value = '';
    document.getElementById('listingTitle').value = '';
    document.getElementById('listingPrice').value = '';
    document.getElementById('listingYear').value = '';
    document.getElementById('listingMileage').value = '';
    document.getElementById('listingDescription').value = '';
    document.getElementById('listingImage').value = '';
    document.getElementById('listingModalTitle').textContent = 'Додати оголошення';
    document.getElementById('listingError').style.display = 'none';
}

function editListing(id) {
    const listing = allListings.find(l => l.id === id);
    if (!listing) return;

    document.getElementById('listingId').value = listing.id;
    document.getElementById('listingTitle').value = listing.title;
    document.getElementById('listingPrice').value = listing.price;
    document.getElementById('listingYear').value = listing.year || '';
    document.getElementById('listingMileage').value = listing.mileage || '';
    document.getElementById('listingDescription').value = listing.description || '';
    document.getElementById('listingImage').value = listing.image || '';
    document.getElementById('listingModalTitle').textContent = 'Редагувати оголошення';
    
    const modal = new bootstrap.Modal(document.getElementById('addListingModal'));
    modal.show();
}

async function saveListingHandler() {
    const errEl = document.getElementById('listingError');
    errEl.style.display = 'none';

    const id = document.getElementById('listingId').value;
    const title = document.getElementById('listingTitle').value.trim();
    const price = document.getElementById('listingPrice').value;
    const year = document.getElementById('listingYear').value;
    const mileage = document.getElementById('listingMileage').value;
    const description = document.getElementById('listingDescription').value.trim();
    const image = document.getElementById('listingImage').value.trim();

    if (!title || !price) {
        errEl.textContent = 'Заповніть назву та ціну';
        errEl.style.display = 'block';
        return;
    }

    const payload = { title, price: Number(price), description, image };
    if (year) payload.year = Number(year);
    if (mileage) payload.mileage = Number(mileage);

    try {
        const isEdit = !!id;
        const url = isEdit ? `/api/listings/${id}` : '/api/listings';
        const method = isEdit ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.error || 'Помилка збереження';
            errEl.style.display = 'block';
            return;
        }

        closeModal('addListingModal');
        await loadListings();
    } catch (e) {
        console.error('Save listing error:', e);
        errEl.textContent = 'Помилка мережі';
        errEl.style.display = 'block';
    }
}

async function deleteListing(id) {
    if (!confirm('Видалити це оголошення?')) return;

    try {
        const res = await fetch(`/api/listings/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!res.ok) {
            const data = await res.json();
            alert(data.error || 'Помилка видалення');
            return;
        }

        await loadListings();
    } catch (e) {
        console.error('Delete listing error:', e);
        alert('Помилка мережі');
    }
}