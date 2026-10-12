'use strict';

const projects = require('../data/projects.json');

exports.list = (req, res) => {
  const { sector } = req.query;
  let result = projects;
  if (sector) {
    result = projects.filter((p) => p.sector.toLowerCase() === String(sector).toLowerCase());
  }
  res.json({ count: result.length, projects: result });
};

exports.getById = (req, res, next) => {
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) {
    const err = new Error(`No project with id "${req.params.id}"`);
    err.status = 404;
    err.code = 'not_found';
    return next(err);
  }
  // include the following project for next-project navigation
  const idx = projects.findIndex((p) => p.id === project.id);
  const nextProject = projects[(idx + 1) % projects.length];
  res.json({ project, next: { id: nextProject.id, name: nextProject.name } });
};
