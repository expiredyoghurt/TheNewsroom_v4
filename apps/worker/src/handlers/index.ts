import type { Handlers } from "../router";
import * as auth from "./auth";
import * as hub from "./hub";
import * as tasks from "./tasks";
import * as classes from "./staffClasses";
import * as assignments from "./staffAssignments";
import * as articles from "./staffArticles";
import * as review from "./staffReview";

/** Typed against the contract: adding a route to @newsroom/shared without a handler here fails to compile. */
export const handlers: Handlers = {
  pupilLogin: auth.pupilLogin, teacherLogin: auth.teacherLogin, parentLogin: auth.parentLogin, logout: auth.logout,
  pupilProfile: hub.pupilProfile, hub: hub.hub, wall: hub.wall, readArticle: hub.readArticle,
  getTask: tasks.getTask, submitMcq: tasks.submitMcq, checkReflect: tasks.checkReflect, submitReflect: tasks.submitReflect,
  getWritingTask: tasks.getWritingTask, submitWriting: tasks.submitWriting, reflectGrade: tasks.reflectGrade, writingGrade: tasks.writingGrade,
  rankings: hub.rankings, goat: hub.goat, thumbnail: hub.thumbnail, articleImage: hub.articleImage, parentClass: hub.parentClass,
  dashboard: classes.dashboard, classes: classes.classes, createClass: classes.createClass, updateClassSettings: classes.updateClassSettings,
  roster: classes.roster, addPupil: classes.addPupil, importRoster: classes.importRoster, removePupil: classes.removePupil,
  resetPupilPassword: classes.resetPupilPassword, changePupilClass: classes.changePupilClass,
  listAssignments: assignments.listAssignments, createAssignment: assignments.createAssignment, updateAssignment: assignments.updateAssignment,
  deleteAssignment: assignments.deleteAssignment, progress: assignments.progress,
  adminArticles: articles.adminArticles, adminArticle: articles.adminArticle, updateArticle: articles.updateArticle, setLearningLoop: articles.setLearningLoop,
  publishArticle: articles.publishArticle, forkArticle: articles.forkArticle, importPrompt: articles.importPrompt, importArticle: articles.importArticle,
  uploadThumbnail: articles.uploadThumbnail, uploadArticleImage: articles.uploadArticleImage, deleteArticleImage: articles.deleteArticleImage,
  reviewQueue: review.reviewQueue, submitReview: review.submitReview, regrade: review.regrade, gradingStats: review.gradingStats,
};
