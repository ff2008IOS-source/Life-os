import {
  taskInput,
  projectInput,
  goalInput,
  milestoneInput,
  reviewInput,
} from "./schemas";
import { academicSchemas } from "./academic-schemas";
export const entitySchemas = {
  tasks: taskInput,
  projects: projectInput,
  goals: goalInput,
  milestones: milestoneInput,
  reviews: reviewInput,
  ...academicSchemas,
};
