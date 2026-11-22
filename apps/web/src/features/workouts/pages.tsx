/**
 * Workouts feature routes (contract: src/shell/README.md): WorkoutNewPage, WorkoutPage, WorkoutEditPage.
 */
import { getRouteApi } from '@tanstack/react-router';
import { WorkoutDetail } from './WorkoutPage';

export { WorkoutNewPage } from './NewWorkoutPage';

const wkApi = getRouteApi('/_app/workouts/$id');
const editApi = getRouteApi('/_app/workouts/$id/edit');

export function WorkoutPage() {
  const { id } = wkApi.useParams();
  return <WorkoutDetail key={id} id={id} edit={false} />;
}

export function WorkoutEditPage() {
  const { id } = editApi.useParams();
  return <WorkoutDetail key={id} id={id} edit />;
}
