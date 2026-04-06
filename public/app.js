$(function () {
 
  var state = {
    mode: 'group',        
    groupId: null,
    staffId: null,
    staffName: '',
    currentWeek: null,    
    prevWeekParam: null,
    nextWeekParam: null,
    scheduleData: null,
  };

  loadGroups();
  $.getJSON('/api/staff', function (list) { staffCacheAll = list; });

  $('.mode-tab').on('click', function () {
    var mode = $(this).data('mode');
    if (mode === state.mode) return;
    state.mode = mode;
    $('.mode-tab').removeClass('active');
    $(this).addClass('active');

    if (mode === 'group') {
      $('#panel-group').removeClass('hidden');
      $('#panel-staff').addClass('hidden');
    } else {
      $('#panel-group').addClass('hidden');
      $('#panel-staff').removeClass('hidden');
    }

    clearSchedule();
  });

  function loadGroups() {
    $.getJSON('/api/groups', function (groups) {
      var $sel = $('#group-select');
      groups.forEach(function (g) {
        $sel.append($('<option>').val(g.id).text(g.name));
      });
    });
  }

  $('#group-select').on('change', function () {
    var id = $(this).val();
    if (!id) return;
    state.groupId = id;
    state.currentWeek = null;
    loadGroupSchedule();
  });

  function loadGroupSchedule() {
    var url = '/api/schedule/group/' + state.groupId;
    if (state.currentWeek) url += '?selectedWeek=' + state.currentWeek;
    fetchSchedule(url);
  }

  var staffSearchTimer = null;
  var staffCacheAll = [];  

  $('#staff-search').on('input', function () {
    var q = $(this).val().trim();
    clearTimeout(staffSearchTimer);
    if (q.length < 2) {
      hideSuggestions();
      return;
    }
    staffSearchTimer = setTimeout(function () { searchStaff(q); }, 400);
  });

  $('#staff-search-btn').on('click', function () {
    var q = $('#staff-search').val().trim();
    if (q.length >= 2) searchStaff(q);
  });

  $('#staff-search').on('keydown', function (e) {
    if (e.key === 'Enter') {
      var q = $(this).val().trim();
      if (q.length >= 2) searchStaff(q);
    }
    if (e.key === 'Escape') hideSuggestions();
  });

  function searchStaff(q) {
    if (staffCacheAll.length) {
      var lq = q.toLowerCase();
      var filtered = staffCacheAll.filter(function (s) {
        return s.name.toLowerCase().indexOf(lq) !== -1;
      });
      showSuggestions(filtered);
      return;
    }
    $.getJSON('/api/staff?q=' + encodeURIComponent(q), function (list) {
      showSuggestions(list);
    }).fail(function () {
      showError('Ошибка поиска преподавателей');
    });
  }

  function showSuggestions(list) {
    var $box = $('#staff-suggestions').empty().removeClass('hidden');
    if (!list.length) {
      $box.append($('<div class="suggestion-item">').text('Ничего не найдено'));
      return;
    }
    list.slice(0, 30).forEach(function (s) {
      $('<div class="suggestion-item">')
        .text(s.name)
        .on('click', function () {
          selectStaff(s.id, s.name);
        })
        .appendTo($box);
    });
  }

  function hideSuggestions() {
    $('#staff-suggestions').addClass('hidden').empty();
  }

  function selectStaff(id, name) {
    state.staffId = id;
    state.staffName = name;
    state.currentWeek = null;
    $('#staff-search').val(name);
    hideSuggestions();
    loadStaffSchedule();
  }

  function loadStaffSchedule() {
    var url = '/api/schedule/staff/' + state.staffId;
    if (state.currentWeek) url += '?selectedWeek=' + state.currentWeek;
    fetchSchedule(url);
  }

  $(document).on('click', function (e) {
    if (!$(e.target).closest('.search-wrap, #staff-search-btn').length) {
      hideSuggestions();
    }
  });

  $('#btn-prev-week').on('click', function () {
    if (!state.prevWeekParam) return;
    state.currentWeek = state.prevWeekParam;
    reloadSchedule();
  });

  $('#btn-next-week').on('click', function () {
    if (!state.nextWeekParam) return;
    state.currentWeek = state.nextWeekParam;
    reloadSchedule();
  });

  function reloadSchedule() {
    if (state.mode === 'group' && state.groupId) {
      loadGroupSchedule();
    } else if (state.mode === 'staff' && state.staffId) {
      loadStaffSchedule();
    }
  }

  function fetchSchedule(url) {
    showLoading(true);
    clearSchedule();
    $.getJSON(url, function (data) {
      state.scheduleData = data;
      state.prevWeekParam = data.prevWeekParam || null;
      state.nextWeekParam = data.nextWeekParam || null;
      renderSchedule(data);
    }).fail(function (xhr) {
      var msg = (xhr.responseJSON && xhr.responseJSON.error)
        ? xhr.responseJSON.error
        : 'Не удалось загрузить расписание. Попробуйте позже.';
      showError(msg);
    }).always(function () {
      showLoading(false);
    });
  }

  function renderSchedule(data) {
    $('#schedule-title').text(data.title || 'Расписание');
    $('#schedule-header').removeClass('hidden');

    $('#current-week-label').text(data.currentWeek || '');
    $('#btn-prev-week').prop('disabled', !data.prevWeekParam);
    $('#btn-next-week').prop('disabled', !data.nextWeekParam);
    $('#week-nav').removeClass('hidden');

    $('#legend').removeClass('hidden');

    renderTable(data);

    renderMobile(data);

    $('#schedule-wrap').removeClass('hidden');
    hideError();
  }

  function renderTable(data) {
    var $thead = $('#schedule-thead').empty();
    var $tbody = $('#schedule-tbody').empty();
    var days = data.days || [];
    var timeSlots = data.timeSlots || [];
    var grid = data.grid || [];

    var $tr = $('<tr>');
    $tr.append($('<th>').text('Время'));
    days.forEach(function (d) {
      $tr.append(
        $('<th>').html(
          '<div>' + capitalize(d.weekday) + '</div>' +
          '<div style="font-weight:400;font-size:11px;opacity:.8">' + d.date + '</div>'
        )
      );
    });
    $thead.append($tr);

    timeSlots.forEach(function (slot, timeIdx) {
      var $row = $('<tr>');
      var parts = slot.split('–');
      $row.append(
        $('<td class="time-cell">').html(
          '<span class="slot-num">' + (timeIdx + 1) + '</span>' +
          (parts[0] || '') + '<br>' + (parts[1] || '')
        )
      );

      var rowData = grid[timeIdx] || [];
      days.forEach(function (_, dayIdx) {
        var lessons = rowData[dayIdx] || [];
        var $td = $('<td>');
        lessons.forEach(function (l) {
          $td.append(buildLessonCard(l));
        });
        $row.append($td);
      });

      $tbody.append($row);
    });
  }

  function renderMobile(data) {
    var $mob = $('#schedule-mobile').empty();
    var days = data.days || [];
    var timeSlots = data.timeSlots || [];
    var grid = data.grid || [];

    days.forEach(function (d, dayIdx) {
      var $acc = $('<div class="day-accordion">');
      var $hdr = $('<div class="day-accordion-header">').html(
        '<span>' + capitalize(d.weekday) + ' — ' + d.date + '</span>' +
        '<span class="chevron">&#8964;</span>'
      );
      var $body = $('<div class="day-accordion-body">');

      var hasLessons = false;

      timeSlots.forEach(function (slot, timeIdx) {
        var lessons = (grid[timeIdx] || [])[dayIdx] || [];
        if (!lessons.length) return;
        hasLessons = true;
        var $slot = $('<div class="mobile-slot">');
        var parts = slot.split('–');
        $slot.append(
          $('<div class="mobile-time">').html(
            (parts[0] || '') + '<br>' + (parts[1] || '')
          )
        );
        var $cards = $('<div class="mobile-lessons">');
        lessons.forEach(function (l) { $cards.append(buildLessonCard(l)); });
        $slot.append($cards);
        $body.append($slot);
      });

      if (!hasLessons) {
        $body.append($('<p style="color:var(--text-muted);font-size:13px;padding:4px 0">Занятий нет</p>'));
      }

      $hdr.on('click', function () {
        var open = $body.hasClass('open');
        $body.toggleClass('open', !open);
        $hdr.toggleClass('open', !open);
      });

      $acc.append($hdr).append($body);
      $mob.append($acc);
    });
  }

  function buildLessonCard(l) {
    var typeClass = lessonTypeClass(l.type);
    var $card = $('<div class="lesson-card">').addClass(typeClass);

    if (l.type) {
      $card.append($('<div class="lesson-type-badge">').text(l.type));
    }

    $card.append($('<div class="lesson-discipline">').text(l.discipline));

    var metaLines = [];
    if (l.place) metaLines.push('<span>' + esc(l.place) + '</span>');
    if (l.teacherName) {
      if (l.teacherStaffId) {
        metaLines.push(
          '<span><a href="#" data-staff-id="' + esc(l.teacherStaffId) + '" data-staff-name="' + esc(l.teacherName) + '" class="staff-link">' + esc(l.teacherName) + '</a></span>'
        );
      } else {
        metaLines.push('<span>' + esc(l.teacherName) + '</span>');
      }
    }
    if (l.subgroups) metaLines.push('<span>' + esc(l.subgroups) + '</span>');
    if (l.comment) metaLines.push('<span>' + esc(l.comment) + '</span>');

    if (metaLines.length) {
      $card.append($('<div class="lesson-meta">').html(metaLines.join('')));
    }

    return $card;
  }

  $(document).on('click', '.staff-link', function (e) {
    e.preventDefault();
    var id = $(this).data('staff-id');
    var name = $(this).data('staff-name');
    state.mode = 'staff';
    $('.mode-tab').removeClass('active');
    $('.mode-tab[data-mode="staff"]').addClass('active');
    $('#panel-group').addClass('hidden');
    $('#panel-staff').removeClass('hidden');
    selectStaff(id, name);
  });

  function lessonTypeClass(type) {
    if (!type) return 'type-other';
    var t = type.toLowerCase();
    if (t.includes('лекц')) return 'type-lecture';
    if (t.includes('лаб')) return 'type-lab';
    if (t.includes('практ')) return 'type-practice';
    if (t.includes('экзам')) return 'type-exam';
    if (t.includes('зачёт') || t.includes('зачет')) return 'type-credit';
    if (t.includes('консульт')) return 'type-consult';
    return 'type-other';
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function esc(s) {
    return $('<div>').text(s).html();
  }

  function showLoading(on) {
    if (on) $('#loading').removeClass('hidden');
    else $('#loading').addClass('hidden');
  }

  function showError(msg) {
    $('#error-msg').text(msg).removeClass('hidden');
  }

  function hideError() {
    $('#error-msg').addClass('hidden').text('');
  }

  function clearSchedule() {
    $('#schedule-wrap').addClass('hidden');
    $('#schedule-header').addClass('hidden');
    $('#week-nav').addClass('hidden');
    $('#legend').addClass('hidden');
    $('#schedule-thead').empty();
    $('#schedule-tbody').empty();
    $('#schedule-mobile').empty();
    hideError();
  }
});
