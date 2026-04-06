const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = 3000;

const BASE_URL = 'https://ssau.ru';

const GROUPS = [
  { id: '1282690301', name: '6411' },
  { id: '1282690279', name: '6412' },
  { id: '1213641978', name: '6413' },
];

const TIME_SLOTS = [
  '08:00–09:35',
  '09:45–11:20',
  '11:30–13:05',
  '13:30–15:05',
  '15:15–16:50',
  '17:00–18:35',
  '18:45–20:20',
];

app.use(express.static(path.join(__dirname, 'public')));

async function parseSchedule(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(response.data);

  const title = $('.h2-text.info-block__title').first().text().trim()
    || $('.h1-text').first().text().replace('Расписание,', '').trim();

  const prevWeekHref = $('.week-nav-prev').attr('href') || null;
  const nextWeekHref = $('.week-nav-next').attr('href') || null;
  const currentWeek = $('.week-nav-current_week').text().trim();

  const days = [];
  $('.schedule__head').each((i, el) => {
    const weekday = $(el).find('.schedule__head-weekday').text().trim();
    const date = $(el).find('.schedule__head-date').text().trim();
    if (weekday) days.push({ weekday, date });
  });

  const dayCount = days.length || 6;

  const pageTimeSlots = [];
  $('.schedule__time').each((_, el) => {
    const times = [];
    $(el).find('.schedule__time-item').each((_, ti) => {
      times.push($(ti).text().replace(/\s+/g, '').trim());
    });
    if (times.length >= 2) pageTimeSlots.push(times[0] + '–' + times[1]);
    else if (times.length === 1) pageTimeSlots.push(times[0]);
  });
  const activeSlots = pageTimeSlots.length ? pageTimeSlots : TIME_SLOTS;

  const grid = Array.from({ length: activeSlots.length }, () =>
    Array.from({ length: dayCount }, () => [])
  );

  const items = $('.schedule__items').children('.schedule__item:not(.schedule__head)');

  items.each((idx, el) => {
    const timeIdx = Math.floor(idx / dayCount);
    const dayIdx = idx % dayCount;

    if (timeIdx >= activeSlots.length) return;

    const lessons = [];
    $(el).find('.schedule__lesson').each((_, lessonEl) => {
      const type = $(lessonEl).find('.schedule__lesson-type-chip').text().trim();
      const discipline = $(lessonEl).find('.schedule__discipline').text().trim();
      const place = $(lessonEl).find('.schedule__place').text().trim();

      const teacherEl = $(lessonEl).find('.schedule__teacher');
      const teacherLink = teacherEl.find('a');
      const teacherName = teacherLink.text().trim() || teacherEl.text().trim();
      const teacherHref = teacherLink.attr('href') || null;
      let teacherStaffId = null;
      if (teacherHref) {
        const m = teacherHref.match(/staffId=(\d+)/);
        if (m) teacherStaffId = m[1];
      }

      const groupsEl = $(lessonEl).find('.schedule__groups');
      const subgroups = groupsEl.find('span.caption-text').text().trim();
      const groupLinks = [];
      groupsEl.find('a').each((_, a) => {
        const href = $(a).attr('href') || '';
        const gm = href.match(/groupId=(\d+)/);
        groupLinks.push({ name: $(a).text().trim(), id: gm ? gm[1] : null });
      });

      const comment = $(lessonEl).find('.schedule__comment').text().trim();

      if (discipline) {
        lessons.push({ type, discipline, place, teacherName, teacherStaffId, subgroups, groupLinks, comment });
      }
    });

    if (lessons.length) grid[timeIdx][dayIdx] = lessons;
  });

  return {
    title,
    currentWeek,
    prevWeekHref: prevWeekHref ? BASE_URL + prevWeekHref : null,
    nextWeekHref: nextWeekHref ? BASE_URL + nextWeekHref : null,
    prevWeekParam: prevWeekHref ? (prevWeekHref.match(/selectedWeek=(\d+)/) || [])[1] : null,
    nextWeekParam: nextWeekHref ? (nextWeekHref.match(/selectedWeek=(\d+)/) || [])[1] : null,
    days,
    timeSlots: activeSlots,
    grid,
  };
}

let staffCache = null;

async function getStaffFromGroups() {
  if (staffCache) return staffCache;

  const staffMap = {};

  const results = await Promise.allSettled(
    GROUPS.map(g => parseSchedule(`${BASE_URL}/rasp?groupId=${g.id}`))
  );

  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const { grid } = r.value;
    grid.forEach(row => {
      row.forEach(cell => {
        cell.forEach(lesson => {
          if (lesson.teacherStaffId && lesson.teacherName && !staffMap[lesson.teacherStaffId]) {
            staffMap[lesson.teacherStaffId] = lesson.teacherName;
          }
        });
      });
    });
  });

  staffCache = Object.entries(staffMap).map(([id, name]) => ({ id, name }));
  staffCache.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return staffCache;
}

async function parseStaffList(query = '') {
  const all = await getStaffFromGroups();
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter(s => s.name.toLowerCase().includes(q));
}

app.get('/api/groups', (req, res) => {
  res.json(GROUPS);
});

app.get('/api/schedule/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { selectedWeek } = req.query;
    let url = `${BASE_URL}/rasp?groupId=${groupId}`;
    if (selectedWeek) url += `&selectedWeek=${selectedWeek}`;
    const data = await parseSchedule(url);
    res.json(data);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Ошибка загрузки расписания группы' });
  }
});

app.get('/api/schedule/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { selectedWeek } = req.query;
    let url = `${BASE_URL}/rasp?staffId=${staffId}`;
    if (selectedWeek) url += `&selectedWeek=${selectedWeek}`;
    const data = await parseSchedule(url);
    res.json(data);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Ошибка загрузки расписания преподавателя' });
  }
});

app.get('/api/staff', async (req, res) => {
  try {
    const { q } = req.query;
    const staff = await parseStaffList(q || '');
    res.json(staff);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Ошибка загрузки списка преподавателей' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
