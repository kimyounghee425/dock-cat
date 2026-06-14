import { PetStage } from './PetStage'

/**
 * Root component. For now it just hosts the pet stage; future settings / pet
 * picker UI lives here (rendered as normal React, separate from the pet loop).
 */
export function App(): JSX.Element {
  return <PetStage />
}
